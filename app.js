console.log('--- 檢查環境變數 ---');
console.log('MONGODB_URI:', process.env.MONGODB_URI);
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;


mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB 雲端金庫連線成功！'))
  .catch(err => console.error('❌ MongoDB 連線失敗：', err));

const expenseSchema = new mongoose.Schema({
  userId: String,
  item: String,
  amount: Number,
  date: { type: Date, default: Date.now }
});

const Expense = mongoose.model('Expense', expenseSchema);

const middlewareConfig = { channelSecret: process.env.CHANNEL_SECRET };
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
});

app.post('/webhook', line.middleware(middlewareConfig), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleEvent(event) { 
  if (event.type !== 'message' || event.message.type !== 'text') return Promise.resolve(null);

  const userId = event.source.userId;
  const userMessage = event.message.text.trim();
  const parts = userMessage.split(/\s+/); 

  // --- 階段 1：處理圖文選單與精確指令 ---
  switch (userMessage) {
    
    // 🔥 【更新】這裡換成了超炫的 Flex Message 九宮格卡片
    case '隨手記一筆':
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'flex',
          altText: '請選擇記帳分類',
          contents: {
            "type": "bubble",
            "size": "kilo",
            "header": {
              "type": "box",
              "layout": "vertical",
              "contents": [
                { "type": "text", "text": "📝 選擇記帳分類", "weight": "bold", "size": "xl", "color": "#F3B562" }
              ]
            },
            "body": {
              "type": "box",
              "layout": "vertical",
              "spacing": "md",
              "contents": [
                {
                  "type": "box",
                  "layout": "horizontal",
                  "spacing": "sm",
                  "contents": [
                    { "type": "button", "style": "secondary", "action": { "type": "message", "label": "🍞 早餐", "text": "早餐" } },
                    { "type": "button", "style": "secondary", "action": { "type": "message", "label": "🍱 午餐", "text": "午餐" } },
                    { "type": "button", "style": "secondary", "action": { "type": "message", "label": "🍜 晚餐", "text": "晚餐" } }
                  ]
                },
                {
                  "type": "box",
                  "layout": "horizontal",
                  "spacing": "sm",
                  "contents": [
                    { "type": "button", "style": "secondary", "action": { "type": "message", "label": "☕ 飲品", "text": "飲品" } },
                    { "type": "button", "style": "secondary", "action": { "type": "message", "label": "🚌 交通", "text": "交通" } },
                    { "type": "button", "style": "secondary", "action": { "type": "message", "label": "🛒 購物", "text": "購物" } }
                  ]
                },
                {
                  "type": "box",
                  "layout": "horizontal",
                  "spacing": "sm",
                  "contents": [
                    { "type": "button", "style": "secondary", "action": { "type": "message", "label": "🎮 娛樂", "text": "娛樂" } },
                    { "type": "button", "style": "secondary", "action": { "type": "message", "label": "🏠 房租", "text": "房租" } },
                    { "type": "button", "style": "secondary", "action": { "type": "message", "label": "✏️ 其他", "text": "其他" } }
                  ]
                }
              ]
            }
          }
        }]
      });

    // 🔥 【新增】處理按鈕點擊後的回覆邏輯
    case '早餐':
    case '午餐':
    case '晚餐':
    case '飲品':
    case '交通':
    case '購物':
    case '娛樂':
    case '房租':
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ 
          type: 'text', 
          text: `好的，你要記帳「${userMessage}」！\n請輸入金額完成記帳，格式如下：\n\n${userMessage} 150` 
        }]
      });
      
    case '其他':
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ 
          type: 'text', 
          text: `沒問題！請直接告訴我你要記什麼項目跟金額。\n\n格式：自訂項目 金額\n（例如：看電影 300）` 
        }]
      });

    // --- 保留原本的其他圖文選單指令 ---
    case '大家來分帳':
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '準備呼叫分帳卡片！(Flex Message 建置中... 🛠️)' }] });
    case '看本月報表':
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '正在為您計算本月花費... (圓餅圖建置中... 📊)' }] });
    case 'AI防剁手諮詢':
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '你好！我是你的 AI 理財顧問，有什麼想問的嗎？(Gemini 連線準備中... 🤖)' }] });
    case '設定生活費預算':
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '請告訴我你這個月的預算目標是多少呢？💰' }] });
    case '使用說明':
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '歡迎使用理財小幫手！\n\n直接輸入「項目 金額」即可記帳。\n輸入「查帳」可看總花費。\n輸入「總表」可看最近 10 筆明細。' }] });
    
    // --- 保留你原本的資料庫指令 ---
    case '查帳':
      const results = await Expense.aggregate([
        { $match: { userId: userId } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]);
      const total = results.length > 0 ? results[0].total : 0;
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `💰 您目前的總支出為：${total} 元。` }] });
      
    case '總表':
      const logs = await Expense.find({ userId: userId }).sort({ date: -1 }).limit(10);
      if (logs.length === 0) return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: "您還沒記過帳喔！" }] });

      let replyText = "📋 最近 10 筆明細：";
      logs.forEach(log => {
        const d = log.date;
        const dateStr = `${d.getMonth()+1}/${d.getDate()}`;
        replyText += `\n- ${dateStr} ${log.item}: ${log.amount} 元`;
      });
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: replyText }] });
  }

  // --- 階段 2：處理記帳功能 (格式：項目 金額) ---
  if (parts.length === 2 && !isNaN(parts[1])) {
    const newExpense = new Expense({ userId: userId, item: parts[0], amount: parseInt(parts[1], 10) });
    await newExpense.save(); 
    return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `✅ 記帳成功：${parts[0]} 花了 ${parts[1]} 元。` }] });
  }

  // --- 階段 3：防呆機制 (聽不懂的時候) ---
  return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `老闆，我聽不懂 QQ。\n\n請透過下方選單操作，或直接輸入「項目 金額」來記帳喔！` }] });
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
console.log('Flex Message 更新拉！');