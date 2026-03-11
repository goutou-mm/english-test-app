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

// ===== 新增：解析题目的智能函数 =====
function parseQuestions(questionsJson) {
    console.log('开始解析题目，原始数据类型:', typeof questionsJson);
    
    let questions = null;
    
    try {
        // 1. 如果已经是对象，转成字符串
        const rawStr = typeof questionsJson === 'string' ? questionsJson : JSON.stringify(questionsJson);
        
        console.log('原始字符串长度:', rawStr.length);
        console.log('原始字符串前100字符:', rawStr.substring(0, 100));
        
        // 2. 尝试解析整个字符串
        let parsedData = JSON.parse(rawStr);
        
        // 3. 检查是否有 output.choices 结构（旧格式）
        if (parsedData.output?.choices?.[0]?.message?.content) {
            console.log('检测到旧格式（output.choices）');
            const innerContent = parsedData.output.choices[0].message.content.trim();
            questions = extractJsonArray(innerContent);
        }
        // 4. 检查是否有 choices 结构（新格式）
        else if (parsedData.choices?.[0]?.message?.content) {
            console.log('检测到新格式（choices）');
            const innerContent = parsedData.choices[0].message.content.trim();
            questions = extractJsonArray(innerContent);
        }
        // 5. 直接就是数组
        else if (Array.isArray(parsedData)) {
            console.log('检测到直接数组格式');
            questions = parsedData;
        }
        // 6. 尝试提取JSON数组
        else {
            console.log('未知格式，尝试提取JSON数组');
            questions = extractJsonArray(rawStr);
        }
        
        // 7. 验证结果
        if (!Array.isArray(questions)) {
            throw new Error('解析结果不是数组');
        }
        
        if (questions.length === 0) {
            throw new Error('题目数组为空');
        }
        
        console.log('题目解析成功，数量:', questions.length);
        return questions;
        
    } catch (e) {
        console.error('解析失败:', e);
        console.error('失败时的数据:', String(questionsJson).substring(0, 500));
        throw new Error(`题目解析失败: ${e.message}`);
    }
}

// ===== 新增：从字符串中提取JSON数组 =====
function extractJsonArray(str) {
    // 1. 移除 Markdown 代码块标记
    let cleaned = str.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    
    console.log('移除Markdown后长度:', cleaned.length);
    
    // 2. 尝试匹配 JSON 数组
    const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
    
    if (arrayMatch) {
        console.log('找到JSON数组，开始解析');
        return JSON.parse(arrayMatch[0]);
    }
    
    // 3. 如果没有匹配到，直接解析
    console.log('未匹配到数组格式，尝试直接解析');
    return JSON.parse(cleaned);
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
        
        // 3. 解析题目（使用新的解析函数）
        let questionsJson = record.fields['AI出题结果'];
        if (!questionsJson) {
            throw new Error('AI出题结果字段为空');
        }
        
        const questions = parseQuestions(questionsJson);
        
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
