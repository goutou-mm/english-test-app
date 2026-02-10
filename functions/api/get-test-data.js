// 文件名: functions/api/get-test-data.js
// Cloudflare Pages Functions 标准格式

// ===== 配置区域 =====
const CONFIG = {
    app_id: 'cli_a9f232801c389cc8', 
    app_secret: 'LE5aYm8IABsEPxeiQPZUyh3RMJPaYGVq',
    app_token: 'Zj9VbXd86adTS3sWAaocizp1nxe',
    table_id: 'tblm28fM4Gtsf1IU'
};

// 工具函数：清洗rid
function cleanRecordId(str) {
    if (!str) return '';
    return str.replace(/\s+/g, '').split('?')[0].split('&')[0].trim();
}

// 工具函数：安全Fetch
async function safeFetch(url, options, stepName) {
    console.log(`[${stepName}] 请求: ${url}`);
    try {
        const response = await fetch(url, options);
        const text = await response.text();
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
        }
        
        const json = JSON.parse(text);
        if (json.code !== undefined && json.code !== 0) {
            throw new Error(`飞书API错误 ${json.code}: ${json.msg}`);
        }
        return json;
    } catch (error) {
        throw new Error(`${stepName}失败: ${error.message}`);
    }
}

// Cloudflare Pages Functions 导出格式
export async function onRequest(context) {
    const { request } = context;
    
    // CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
    
    // 处理OPTIONS
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }
    
    try {
        // 获取rid参数
        const url = new URL(request.url);
        const recordId = cleanRecordId(url.searchParams.get('rid'));
        
        console.log('收到请求，rid:', recordId);
        
        if (!recordId) {
            return new Response(JSON.stringify({ 
                error: '缺少rid参数',
                success: false 
            }), { 
                status: 400, 
                headers: corsHeaders 
            });
        }
        
        // 1. 获取Token
        console.log('开始获取飞书Token...');
        const tokenData = await safeFetch(
            'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    app_id: CONFIG.app_id, 
                    app_secret: CONFIG.app_secret 
                })
            },
            '获取Token'
        );
        
        const accessToken = tokenData.tenant_access_token;
        if (!accessToken) {
            throw new Error('Token为空');
        }
        console.log('Token获取成功');
        
        // 2. 获取记录
        console.log('开始获取记录...');
        const recordUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${CONFIG.app_token}/tables/${CONFIG.table_id}/records/${recordId}`;
        const recordRes = await safeFetch(
            recordUrl,
            {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            },
            '获取记录'
        );
        
        const record = recordRes.data?.record;
        if (!record) {
            throw new Error('记录为空');
        }
        console.log('记录获取成功，学生:', record.fields['学生姓名']);
        
        // 3. 解析题目
        let questionsJson = record.fields['AI出题结果'];
        if (!questionsJson) {
            throw new Error('AI出题结果字段为空');
        }
        
        console.log('开始解析题目，原始数据长度:', String(questionsJson).length);
        
        let questions = null;
        try {
            const rawStr = typeof questionsJson === 'string' ? questionsJson : JSON.stringify(questionsJson);
            const parsedRaw = JSON.parse(rawStr);
            
            let innerContent = "";
            if (parsedRaw.output?.choices?.[0]?.message?.content) {
                innerContent = parsedRaw.output.choices[0].message.content.trim();
            } else {
                innerContent = rawStr.trim();
            }
            
            const match = innerContent.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (match) {
                questions = JSON.parse(match[0]);
            } else {
                questions = JSON.parse(innerContent);
            }
            
            if (!Array.isArray(questions)) {
                throw new Error('解析结果不是数组');
            }
            
            console.log('题目解析成功，数量:', questions.length);
            
        } catch (e) {
            console.error('解析失败:', e);
            throw new Error(`题目解析失败: ${e.message}`);
        }
        
        // 4. 返回成功
        return new Response(JSON.stringify({
            success: true,
            data: {
                studentName: record.fields['学生姓名'] || '未知',
                questions: questions,
                total: questions.length
            }
        }), {
            status: 200,
            headers: corsHeaders
        });
        
    } catch (error) {
        console.error('错误:', error);
        return new Response(JSON.stringify({
            error: error.message,
            success: false,
            debug: {
                app_id_ok: !!CONFIG.app_id,
                app_token_ok: !!CONFIG.app_token
            }
        }), {
            status: 500,
            headers: corsHeaders
        });
    }
}
