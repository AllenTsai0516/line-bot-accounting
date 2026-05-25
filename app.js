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
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => { console.error(err); res.status(500).end(); });
});

// 🔥 升級版的小本本：現在可以存物件，記錄更複雜的步驟
const userState = {};

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
  // 🔥 階段 0：攔截狀態記憶 (記帳 & 分帳)
  // ==========================================
  const state = userState[userId];
  const menuCommands = ['隨手記一筆', '大家來分帳', '看本月報表', 'AI防剁手諮詢', '設定生活費預算', '使用說明', '取消'];

  if (state) {
    // 如果中途按了選單，就擦掉小本本，讓程式繼續往下跑進入選單邏輯
    if (menuCommands.includes(userMessage)) {
      delete userState[userId];
    } 
    // --- 處理「隨手記一筆」的後續輸入 ---
    else if (state.action === 'expense') {
      if (!isNaN(userMessage)) {
        const amount = parseInt(userMessage, 10);
        const newExpense = new Expense({ userId: userId, item: state.category, amount: amount });
        await newExpense.save();
        delete userState[userId];
        return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `✅ 記帳成功：${state.category} 花了 ${amount} 元。` }] });
      } else {
        return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ 請輸入「純數字」金額喔！\n（或輸入「取消」）` }] });
      }
    }
    // --- 🔥 處理「大家來分帳」的三步驟邏輯 ---
    else if (state.action === 'split') {
      if (state.step === 1) {
        state.name = userMessage; // 記下活動名稱
        state.step = 2;           // 進入下一步
        return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `好的！這次「${state.name}」總共花了多少錢呢？\n（請輸入純數字）` }] });
      } 
      else if (state.step === 2) {
        if (!isNaN(userMessage)) {
          state.amount = parseInt(userMessage, 10);
          state.step = 3;
          return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `收到，總金額 ${state.amount} 元。\n請問總共是「幾個人」要分攤呢？\n（包含自己，請輸入純數字）` }] });
        } else {
          return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ 金額必須是「純數字」喔！請再輸入一次：` }] });
        }
      }
      else if (state.step === 3) {
        if (!isNaN(userMessage)) {
          const people = parseInt(userMessage, 10);
          // 使用 Math.ceil 無條件進位，避免小數點分不平
          const perPerson = Math.ceil(state.amount / people); 
          
          // 準備要傳送給好友的文字 (需要編碼才能放入網址)
          const shareText = `嗨！我們剛剛的「${state.name}」總共是 ${state.amount} 元。\n${people} 個人平均分攤，一個人是 ${perPerson} 元喔！💸\n再麻煩記得轉帳給我，謝謝啦～`;
          const shareUrl = `https://line.me/R/msg/text/?text=${encodeURIComponent(shareText)}`;

          delete userState[userId]; // 完成後擦掉小本本

          // 回傳分帳結果卡片
          return client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
              type: 'flex',
              altText: `分帳計算出爐：每人 ${perPerson} 元`,
              contents: {
                "type": "bubble",
                "size": "mega",
                "body": {
                  "type": "box", "layout": "vertical",
                  "contents": [
                    { "type": "text", "text": "🍽️ 分帳計算完成", "weight": "bold", "color": "#1DB446", "size": "sm" },
                    { "type": "text", "text": state.name, "weight": "bold", "size": "xxl", "margin": "md" },
                    { "type": "separator", "margin": "xxl" },
                    {
                      "type": "box", "layout": "vertical", "margin": "xxl", "spacing": "sm",
                      "contents": [
                        { "type": "box", "layout": "horizontal", "contents": [{ "type": "text", "text": "總金額", "size": "sm", "color": "#555555" }, { "type": "text", "text": `NT$ ${state.amount}`, "size": "sm", "color": "#111111", "align": "end" }] },
                        { "type": "box", "layout": "horizontal", "contents": [{ "type": "text", "text": "分攤人數", "size": "sm", "color": "#555555" }, { "type": "text", "text": `${people} 人`, "size": "sm", "color": "#111111", "align": "end" }] }
                      ]
                    },
                    { "type": "separator", "margin": "xxl" },
                    {
                      "type": "box", "layout": "horizontal", "margin": "md",
                      "contents": [
                        { "type": "text", "text": "每人需付款", "size": "md", "color": "#555555", "weight": "bold", "align": "start", "gravity": "center" },
                        { "type": "text", "text": `NT$ ${perPerson}`, "size": "xl", "color": "#F3B562", "weight": "bold", "align": "end" }
                      ]
                    }
                  ]
                },
                "footer": {
                  "type": "box", "layout": "vertical",
                  "contents": [
                    {
                      "type": "button", "style": "primary", "color": "#1DB446",
                      "action": { "type": "uri", "label": "轉傳給好友 📤", "uri": shareUrl }
                    }
                  ]
                }
              }
            }]
          });
        } else {
          return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ 人數必須是「純數字」喔！請再輸入一次：` }] });
        }
      }
    }
  }

  // ==========================================
  // 階段 1：處理圖文選單
  // ==========================================
  switch (userMessage) {
    case '隨手記一筆':
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'flex', altText: '請選擇記帳分類',
          contents: {
            "type": "bubble", "size": "kilo",
            "header": { "type": "box", "layout": "vertical", "contents": [{ "type": "text", "text": "📝 選擇記帳分類", "weight": "bold", "size": "xl", "color": "#F3B562" }] },
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

    case '早餐': case '午餐': case '晚餐': case '飲品': case '交通': case '購物': case '娛樂': case '房租':
      userState[userId] = { action: 'expense', category: userMessage }; // 修改這裡：存入物件狀態
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `好的，你要記帳「${userMessage}」！\n👉 請直接輸入花費金額（純數字）：` }] });
      
    case '其他':
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `沒問題！請直接告訴我你要記什麼。\n\n格式：項目 金額\n（例如：看電影 300）` }] });

    // 🔥 啟動分帳小本本
    case '大家來分帳':
      userState[userId] = { action: 'split', step: 1, name: '', amount: 0 };
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '🍻 進入分帳模式！\n\n請輸入這次聚會或餐廳的「名稱」：\n（例如：好樂迪唱歌）' }] });

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
  // 階段 2：處理舊版記帳功能
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
console.log('超強分帳功能上線拉！');