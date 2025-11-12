const axios = require('axios');
const { chromium } = require('playwright');

// === 环境变量读取 ===
const token = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;
const accounts = process.env.ACCOUNTS;

if (!accounts) {
  console.log('❌ 未配置账号：请设置环境变量 ACCOUNTS="user1:pass1,user2:pass2"');
  process.exit(1);
}

// 解析账号：支持逗号或分号分隔
const accountList = accounts
  .split(/[,;]/)
  .map(account => {
    const [user, pass] = account.split(':').map(s => s.trim());
    return { user, pass };
  })
  .filter(acc => acc.user && acc.pass);

if (accountList.length === 0) {
  console.log('❌ 账号格式错误，应为 username1:password1,username2:password2');
  process.exit(1);
}

// === 工具函数：发送 Telegram 通知 ===
async function sendTelegram(message) {
  if (!token || !chatId) {
    console.log('⚠️ Telegram 通知跳过：BOT_TOKEN 或 CHAT_ID 未配置');
    return;
  }

  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const timeStr = beijingTime.toISOString().replace('T', ' ').substring(0, 19) + " CST";

  const fullMessage = `🎉 Netlib 登录通知\n\n登录时间：${timeStr}\n\n${message}`;

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: fullMessage
    }, { timeout: 10000 });
    console.log('✅ Telegram 通知发送成功');
  } catch (e) {
    console.error('⚠️ Telegram 发送失败:', e.message || e);
  }
}

// === 工具函数：发送企业微信 Webhook 通知（纯文本） ===
async function sendWeCom(message) {
  const webhookUrl = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=e95c6f16-edc6-4d0c-9f2b-c2793b3a164e';

  const payload = {
    msgtype: 'text',
    text: {
      content: message
      // 可选：指定接收人（userid列表，用空格分隔）
      // mentioned_list: ['wanghui', 'WB01997504']
    }
  };

  try {
    await axios.post(webhookUrl, payload, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('✅ 企业微信 Webhook 通知（纯文本）发送成功');
  } catch (e) {
    console.error('⚠️ 企业微信 Webhook 发送失败:', e.message || e);
  }
}

// === 核心功能：单账号登录 ===
async function loginWithAccount(user, pass) {
  console.log(`\n🚀 开始登录账号: ${user}`);

  let browser = null;
  let page = null;
  const result = { user, success: false, message: '' };

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    page = await browser.newPage();
    page.setDefaultTimeout(30000);

    console.log(`📱 ${user} - 访问网站...`);
    await page.goto('https://www.netlib.re/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    console.log(`🔑 ${user} - 点击登录按钮...`);
    await page.click('text=Login', { timeout: 5000 });

    await page.waitForTimeout(2000);

    console.log(`📝 ${user} - 填写用户名...`);
    await page.fill('input[name="username"], input[type="text"]', user);
    await page.waitForTimeout(1000);

    console.log(`🔒 ${user} - 填写密码...`);
    await page.fill('input[name="password"], input[type="password"]', pass);
    await page.waitForTimeout(1000);

    console.log(`📤 ${user} - 提交登录...`);
    await page.click('button:has-text("Validate"), input[type="submit"]');

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    // 检查登录结果
    const content = await page.content();
    if (content.includes('exclusive owner') || content.includes(user)) {
      console.log(`✅ ${user} - 登录成功`);
      result.success = true;
      result.message = `✅ ${user} 登录成功`;
    } else {
      console.log(`❌ ${user} - 登录失败`);
      result.message = `❌ ${user} 登录失败`;
    }
  } catch (e) {
    console.error(`❌ ${user} - 登录异常:`, e.message);
    result.message = `❌ ${user} 登录异常: ${e.message}`;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  return result;
}

// === 主流程 ===
async function main() {
  console.log(`🔍 共发现 ${accountList.length} 个账号需要登录`);

  const results = [];

  for (let i = 0; i < accountList.length; i++) {
    const { user, pass } = accountList[i];
    console.log(`\n📋 处理第 ${i + 1}/${accountList.length} 个账号: ${user}`);

    const res = await loginWithAccount(user, pass);
    results.push(res);

    if (i < accountList.length - 1) {
      console.log('⏳ 等待 3 秒后处理下一个账号...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // 汇总结果
  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;

  let textSummary = `📊 登录汇总: ${successCount}/${totalCount} 个账号成功\n\n`;
  results.forEach(r => {
    textSummary += `${r.message}\n`;
  });

  // 获取北京时间字符串（用于通知）
  const beijingTimeStr = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  // 发送 Telegram
  await sendTelegram(textSummary);

  // 发送企业微信（Markdown 格式）
  const markdownSummary =
    `## 🎉 Netlib 登录通知\n` +
    `\n> 登录时间：${beijingTimeStr} (CST)\n` +
    `\n${textSummary.trim()}\n` +
    `\n---\n` +
    `> ☁️ 自动化登录服务 | Playwright + Node.js`;

  await sendWeCom(markdownSummary);

  console.log('\n✅ 所有账号处理完成！');
}

// 启动
main().catch(err => {
  console.error('💥 主流程异常:', err);
  process.exit(1);
});
