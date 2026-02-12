// 文件名: functions/api/submit-test.js
// 自动提交测试结果到飞书多维表格

const CONFIG = {
    app_id: 'cli_a9f232801c389cc8', 
    app_secret: 'LE5aYm8IABsEPxeiQPZUyh3RMJPaYGVq',
    app_token: 'Zj9VbXd86adTS3sWAaocizp1nxe',
    table_id: 'tblm28fM4Gtsf1IU'
};

// 获取Token
async function getAccessToken() {
    const response = await fetch(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_id: CONFIG.app_id,
                app_secret: CONFIG.app_secret
            })
        }
    );
    
    const data = await response.json();
    if (data.code !== 0 && !data.tenant_access_token) {
        throw new Error('获取Token失败');
    }
    return data.tenant_access_token;
}

// 更新记录
async function updateRecord(recordId, fields, accessToken) {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${CONFIG.app_token}/tables/${CONFIG.table_id}/records/${recordId}`;
    
    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
    });
    
    const data = await response.json();
    if (data.code !== 0) {
        throw new Error(`更新失败: ${data.msg}`);
    }
    return data;
}

// Cloudflare Pages Function
export async function onRequest(context) {
    const { request } = context;
    
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
    
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }
    
    try {
        // 获取提交的数据
        const body = await request.json();
        const { recordId, studentName, score, behaviorData } = body;
        
        console.log('收到提交:', { recordId, studentName, score });
        
        if (!recordId || !studentName || score === undefined) {
            return new Response(JSON.stringify({
                success: false,
                error: '缺少必要参数'
            }), { status: 400, headers: corsHeaders });
        }
        
        // 1. 获取Token
        const accessToken = await getAccessToken();
        
        // 2. 准备要更新的字段
        const fields = {
            '学生姓名': studentName,
            '测试分数': score,
            '学习行为数据': JSON.stringify(behaviorData),
            '提交时间': new Date().toISOString()
        };
        
        // 3. 更新记录
        await updateRecord(recordId, fields, accessToken);
        
        console.log('提交成功:', recordId);
        
        // 4. 返回成功
        return new Response(JSON.stringify({
            success: true,
            message: '提交成功！',
            data: {
                studentName,
                score,
                submitTime: fields['提交时间']
            }
        }), {
            status: 200,
            headers: corsHeaders
        });
        
    } catch (error) {
        console.error('提交失败:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: corsHeaders
        });
    }
}
