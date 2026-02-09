// 文件名: functions/api/get-test-data.js
// 适配 Cloudflare Functions 环境
// ===== 配置区域 (请在这里填入你的真实信息) =====
const CONFIG = {
    // 你的飞书 App ID (cli_开头)
    app_id: 'cli_a9f232801c389cc8', 
    // 你的 App Secret
    app_secret: 'LE5aYm8IABsEPxeiQPZUyh3RMJPaYGVq',
    // 你的多维表格 Token (base开头, 在浏览器地址栏找)
    app_token: 'Zj9VbXd86adTS3sWAaocizp1nxe',
    // 你的数据表 ID (tbl开头, 在浏览器地址栏找)
    table_id: 'tblm28fM4Gtsf1IU'
};

// --- 工具函数：仅清洗用户传入的rid参数（配置项不清洗） ---
function cleanRecordId(str) {
    if (!str) return '';
    // 仅清洗rid参数：移除空格、特殊符号、URL参数干扰
    return str.replace(/\s+/g, '')
              .split('?')[0]
              .split('&')[0]
              .trim();
}

// --- 工具函数：安全的 Fetch 请求 ---
async function safeFetch(url, options, stepName) {
    console.log(`[${stepName}] 请求: ${url}`);
    try {
        const response = await fetch(url, options);
        const text = await response.text(); 

        if (!response.ok) {
            throw new Error(`[${stepName}] HTTP错误 ${response.status}: ${text.substring(0, 200)}`);
        }

        try {
            const json = JSON.parse(text);
            // 飞书API正常返回code为0，特殊处理token接口（返回的是tenant_access_token，无code）
            if (json.code !== undefined && json.code !== 0) {
                throw new Error(`[${stepName}] 飞书API报错 (Code ${json.code}): ${json.msg}`);
            }
            return json;
        } catch (e) {
            if (e.message.includes('飞书API报错')) throw e;
            throw new Error(`[${stepName}] 返回了非 JSON 数据: ${text.substring(0, 100)}...`);
        }
    } catch (error) {
        throw new Error(`网络请求失败 (${stepName}): ${error.message}`);
    }
}

// --- Cloudflare Functions 主处理函数 ---
export default {
    async fetch(request, env, ctx) {
        // 解析请求URL和参数
        const url = new URL(request.url);
        const req = {
            method: request.method,
            query: Object.fromEntries(url.searchParams),
            headers: request.headers
        };

        // 1. 设置跨域 (CORS)
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // 处理预检请求
        if (req.method === 'OPTIONS') {
            return new Response(null, {
                headers: corsHeaders
            });
        }

        try {
            // 2. 获取并清洗记录 ID（仅清洗rid，配置项不洗）
            const recordId = cleanRecordId(req.query.rid);
            if (!recordId) {
                return new Response(JSON.stringify({ 
                    error: '请在URL中提供 rid 参数 (例如: ?rid=recXXXX)', 
                    success: false 
                }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // 3. 获取 Access Token
            const tokenUrl = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
            const tokenData = await safeFetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    app_id: CONFIG.app_id, 
                    app_secret: CONFIG.app_secret 
                })
            }, '获取Token');
            
            const accessToken = tokenData.tenant_access_token;
            if (!accessToken) throw new Error('获取到的Token为空，请检查飞书App权限');

            // 4. 获取记录详情
            const recordUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${CONFIG.app_token}/tables/${CONFIG.table_id}/records/${recordId}`;
            const recordRes = await safeFetch(recordUrl, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }, '获取记录');

            const record = recordRes.data.record;
            if (!record) throw new Error('飞书返回记录为空，请检查recordId是否正确');
            
            // 5. 解析 AI 数据（增加兜底逻辑）
            let questionsJson = record.fields['AI出题结果'];
            if (!questionsJson) throw new Error('找到记录了，但"AI出题结果"这一列是空的！');

            let questions = null;
            let innerContent = "";

            try {
                // 第一步：标准化原始数据
                const rawStr = typeof questionsJson === 'string' ? questionsJson : JSON.stringify(questionsJson);
                // 第二步：兼容 DeepSeek 结构
                const parsedRaw = JSON.parse(rawStr);
                if (parsedRaw.output && parsedRaw.output.choices) {
                    innerContent = parsedRaw.output.choices[0].message.content.trim();
                } else {
                    innerContent = rawStr.trim();
                }
                
                // 第三步：提取JSON数组（增加兜底）
                const match = innerContent.match(/\[\s*\{[\s\S]*\}\s*\]/); // 优化正则匹配
                if (match && match[0]) {
                    questions = JSON.parse(match[0]);
                } else {
                    // 兜底：尝试直接解析（若本身就是数组）
                    questions = JSON.parse(innerContent);
                }

                // 校验：确保是数组
                if (!Array.isArray(questions)) {
                    throw new Error('解析结果不是JSON数组');
                }
            } catch (e) {
                throw new Error(`AI数据解析失败: ${e.message}. 原始数据前100字: ${String(questionsJson).substring(0, 100)}`);
            }

            // 6. 返回成功结果
            return new Response(JSON.stringify({
                success: true,
                data: { 
                    studentName: record.fields['学生姓名'] || '未知',
                    questions: questions,
                    total: questions.length
                }
            }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });

        } catch (error) {
            // 7. 错误返回（保留调试信息）
            console.error('全局错误:', error);
            return new Response(JSON.stringify({ 
                error: error.message, 
                debug_info: {
                    record_id: req.query.rid,
                    app_id_configured: !!CONFIG.app_id,
                    app_token_configured: !!CONFIG.app_token
                },
                success: false 
            }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }
};