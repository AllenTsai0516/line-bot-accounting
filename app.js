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

// 🔥 【新增】機器人的小本本：用來記憶使用者「正在記哪個分類的帳」
const userState = {};

// 產生精美 App 按鈕的輔助函數
function createIconBox(emoji, text) {
  return {
    "type": "box", "layout": "vertical", "backgroundColor": "#f4f4f4",
    "cornerRadius": "10px", "paddingAll": "10px", "alignItems": "center",
    "action": { "type": "message", "label": text, "text": text },
    "contents": [
      { "type": "text", "text": emoji, "size": "xl" },
      { "type": "text", "text": text, "size": "sm", "weight": "bold", "color": "#555555", "margin": "sm" }
    ]
  };
}

async function handleEvent(event) { 
  if (event.type !== 'message' || event.message.type !== 'text') return Promise.resolve(null);

  const userId = event.source.userId;
  const userMessage = event.message.text.trim();
  const parts = userMessage.split(/\s+/); 

  // ==========================================
  // 🔥 階段 0：檢查使用者是不是「正在輸入金額」
  // ==========================================
  if (userState[userId]) {
    const category = userState[userId]; // 拿回剛剛記下的分類 (例如: 晚餐)
    
    // 如果使用者這時候點了其他圖文選單，就取消記帳狀態
    const menuCommands = ['隨手記一筆', '大家來分帳', '看本月報表', 'AI防剁手諮詢', '設定生活費預算', '使用說明', '取消'];
    if (menuCommands.includes(userMessage)) {
      delete userState[userId]; // 擦掉小本本
    } 
    // 如果輸入的是純數字，就直接存進資料庫！
    else if (!isNaN(userMessage)) {
      const amount = parseInt(userMessage, 10);
      const newExpense = new Expense({ userId: userId, item: category, amount: amount });
      await newExpense.save();
      delete userState[userId]; // 存完擦掉小本本
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `✅ 記帳成功：${category} 花了 ${amount} 元。` }] });
    } 
    // 如果亂打字，溫柔提醒
    else {
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ 請輸入「純數字」金額喔！\n（或輸入「取消」放棄這次記帳）` }] });
    }
  }

  // ==========================================
  // 階段 1：處理圖文選單與精確指令
  // ==========================================
  switch (userMessage) {
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
              "type": "box", "layout": "vertical",
              "contents": [{ "type": "text", "text": "📝 選擇記帳分類", "weight": "bold", "size": "xl", "color": "#F3B562" }]
            },
            "body": {
              "type": "box", "layout": "vertical", "spacing": "md",
              "contents": [
                { "type": "box", "layout": "horizontal", "spacing": "md", "contents": [ createIconBox("🍞", "早餐"), createIconBox("🍱", "午餐"), createIconBox("🍜", "晚餐") ] },
                { "type": "box", "layout": "horizontal", "spacing": "md", "contents": [ createIconBox("☕", "飲品"), createIconBox("🚌", "交通"), createIconBox("🛒", "購物") ] },
                { "type": "box", "layout": "horizontal", "spacing": "md", "contents": [ createIconBox("🎮", "娛樂"), createIconBox("🏠", "房租"), createIconBox("✏️", "其他") ] }
              ]
            }
          }
        }]
      });

    // 🔥 點擊分類按鈕後的處理：把狀態記進小本本
    case '早餐': case '午餐': case '晚餐': case '飲品': case '交通': case '購物': case '娛樂': case '房租':
      userState[userId] = userMessage; // 偷偷記下分類
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `好的，你要記帳「${userMessage}」！\n👉 請直接輸入花費金額（純數字）：` }]
      });
      
    // 「其他」選項不啟動狀態記憶，因為我們需要他同時打項目跟金額
    case '其他':
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `沒問題！請直接告訴我你要記什麼。\n\n格式：項目 金額\n（例如：看電影 300）` }] });

    // --- 其他功能保留區 ---
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
    
    // --- 原本的資料庫指令 ---
    case '查帳':
      const results = await Expense.aggregate([ { $match: { userId: userId } }, { $group: { _id: null, total: { $sum: "$amount" } } } ]);
      const total = results.length > 0 ? results[0].total : 0;
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `💰 您目前的總支出為：${total} 元。` }] });
      
    case '總表':
      const logs = await Expense.find({ userId: userId }).sort({ date: -1 }).limit(10);
      if (logs.length === 0) return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: "您還沒記過帳喔！" }] });
      let replyText = "📋 最近 10 筆明細：";
      logs.forEach(log => { replyText += `\n- ${log.date.getMonth()+1}/${log.date.getDate()} ${log.item}: ${log.amount} 元`; });
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: replyText }] });
  }

  // ==========================================
  // 階段 2：處理舊版記帳功能 (格式：項目 金額)
  // ==========================================
  if (parts.length === 2 && !isNaN(parts[1])) {
    const newExpense = new Expense({ userId: userId, item: parts[0], amount: parseInt(parts[1], 10) });
    await newExpense.save(); 
    return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `✅ 記帳成功：${parts[0]} 花了 ${parts[1]} 元。` }] });
  }

  // ==========================================
  // 階段 3：防呆機制
  // ==========================================
  return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `老闆，我聽不懂 QQ。\n\n請透過下方選單操作，或直接輸入「項目 金額」來記帳喔！` }] });
}

app.listen(port, () => { console.log(`Server is running on http://localhost:${port}`); });
console.log('超美九宮格與狀態記憶更新拉！');