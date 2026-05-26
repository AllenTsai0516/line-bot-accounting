console.log('--- 檢查環境變數 ---');
console.log('MONGODB_URI:', process.env.MONGODB_URI);
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;

// 連線到 MongoDB
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

// 機器人的小本本 (狀態記憶)
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
  // 階段 0：攔截狀態記憶 (記帳 & 分帳)
  // ==========================================
  const state = userState[userId];
  const menuCommands = ['隨手記一筆', '大家來分帳', '看本月報表', 'AI防剁手諮詢', '設定生活費預算', '使用說明', '取消', '刪除最後一筆'];

  if (state) {
    // 如果中途按了選單，就擦掉小本本，讓程式繼續往下跑
    if (menuCommands.includes(userMessage)) {
      delete userState[userId];
    } 
    // 處理「隨手記一筆」的後續輸入
    else if (state.action === 'expense') {
      if (!isNaN(userMessage)) {
        const amount = parseInt(userMessage, 10);
        const newExpense = new Expense({ userId: userId, item: state.category, amount: amount });
        await newExpense.save();
        delete userState[userId];
        return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `✅ 記帳成功：${state.category} 花了 ${amount} 元。\n\n💡 若輸入錯誤，可輸入「刪除 ${state.category}」或「刪除最後一筆」。` }] });
      } else {
        return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ 請輸入「純數字」金額喔！\n（或輸入「取消」）` }] });
      }
    }
    // 處理「大家來分帳」的三步驟邏輯
    else if (state.action === 'split') {
        if (state.step === 1) { 
          state.name = userMessage; 
          state.step = 2; 
          return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `好的！這次「${state.name}」總共花了多少錢呢？` }] }); 
        } 
        else if (state.step === 2) {
          if (!isNaN(userMessage)) { 
            state.amount = parseInt(userMessage, 10); 
            state.step = 3; 
            return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `收到，總金額 ${state.amount} 元。請問總共幾個人分攤？` }] });
          } else { 
            return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ 金額請輸入純數字：` }] }); 
          }
        }
        else if (state.step === 3) {
          if (!isNaN(userMessage)) {
            const people = parseInt(userMessage, 10);
            const perPerson = Math.ceil(state.amount / people); 
            const shareText = `嗨！我們剛剛的「${state.name}」分帳：一人 ${perPerson} 元喔！💸`;
            const shareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(shareText)}`;
            delete userState[userId];
            
            return client.replyMessage({ 
              replyToken: event.replyToken, 
              messages: [{ 
                type: 'flex', altText: `分帳結果出爐`, 
                contents: { 
                  "type": "bubble", "size": "mega", 
                  "body": { 
                    "type": "box", "layout": "vertical", 
                    "contents": [ 
                      { "type": "text", "text": "🍽️ 分帳計算完成", "weight": "bold", "color": "#1DB446", "size": "sm" }, 
                      { "type": "text", "text": state.name, "weight": "bold", "size": "xxl", "margin": "md" }, 
                      { "type": "box", "layout": "horizontal", "margin": "md", "contents": [ { "type": "text", "text": "每人需付款", "size": "md", "color": "#555555", "weight": "bold" }, { "type": "text", "text": `NT$ ${perPerson}`, "size": "xl", "color": "#F3B562", "weight": "bold", "align": "end" } ] } 
                    ] 
                  }, 
                  "footer": { 
                    "type": "box", "layout": "vertical", 
                    "contents": [ { "type": "button", "style": "primary", "color": "#1DB446", "action": { "type": "uri", "label": "轉傳給好友 📤", "uri": shareUrl } } ] 
                  } 
                } 
              }] 
            });
          } else {
            return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `⚠️ 人數請輸入純數字：` }] });
          }
        }
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
      userState[userId] = { action: 'expense', category: userMessage };
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `好的，你要記帳「${userMessage}」！\n👉 請輸入花費金額：` }] });

    case '大家來分帳':
      userState[userId] = { action: 'split', step: 1, name: '', amount: 0 };
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '🍻 進入分帳模式！\n\n請輸入聚會名稱：' }] });

    // 🔥 終極版報表：乾淨甜甜圈 + 右側整齊圖例 (完美解決資料懸殊跑版問題)
    case '看本月報表':
      const currentMonth = new Date().getMonth();
      const stats = await Expense.aggregate([
        { $match: { userId: userId, date: { $gte: new Date(new Date().getFullYear(), currentMonth, 1) } } },
        { $group: { _id: "$item", total: { $sum: "$amount" } } }
      ]);

      if (stats.length === 0) return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: "本月還沒有記帳紀錄喔！" }] });

      // 將項目與金額綁在一起作為圖例標籤
      const labels = stats.map(s => `${s._id}: ${s.total}元`);
      const data = stats.map(s => s.total);
      const grandTotal = data.reduce((a, b) => a + b, 0);

      const chartConfig = {
        type: 'doughnut', 
        data: {
          labels: labels,
          datasets: [{
            data: data,
            backgroundColor: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#82E0AA'],
            borderWidth: 2
          }]
        },
        options: {
          cutoutPercentage: 65,
          layout: { padding: 20 },
          plugins: {
            legend: { 
              position: 'right',
              labels: { fontSize: 16, padding: 15 }
            },
            datalabels: { display: false }, // 關掉會重疊的圓餅圖內嵌數字
            doughnutlabel: { 
              labels: [
                { text: '總支出', font: { size: 18, color: '#555555' } }, 
                { text: `NT$ ${grandTotal}`, font: { size: 24, weight: 'bold', color: '#111111' } }
              ] 
            }
          }
        }
      };
      
      const chartUrl = `https://quickchart.io/chart?w=700&h=400&bkg=white&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

      return client.replyMessage({ replyToken: event.replyToken, messages: [
        { type: 'text', text: `📊 本月消費分析報告：\n總支出為：${grandTotal} 元。` },
        { type: 'image', originalContentUrl: chartUrl, previewImageUrl: chartUrl }
      ]});

    case '刪除最後一筆':
      const lastEntry = await Expense.findOne({ userId: userId }).sort({ date: -1 });
      if (!lastEntry) return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: "找不到記帳紀錄可以刪除喔！" }] });
      
      await Expense.findByIdAndDelete(lastEntry._id);
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `🗑️ 已刪除最後一筆紀錄：\n「${lastEntry.item} ${lastEntry.amount} 元」` }] });

    case 'AI防剁手諮詢':
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '你好！我是你的 AI 理財顧問。(Gemini 連線準備中... 🤖)' }] });
      
    case '設定生活費預算':
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '請告訴我你這個月的預算目標是多少呢？💰' }] });
      
    case '使用說明':
      return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '歡迎使用理財小幫手！\n\n直接點擊下方選單，或輸入「項目 金額」即可記帳。\n輸入「刪除 午餐」可快速刪除特定紀錄。' }] });
  }

  // ==========================================
  // 階段 2：處理「刪除 [特定項目/金額]」功能
  // ==========================================
  if (userMessage.startsWith('刪除 ')) {
    const targetStr = userMessage.replace('刪除 ', '').trim();
    let query = { userId: userId };

    if (!isNaN(targetStr)) {
      query.amount = parseInt(targetStr, 10);
    } else {
      query.item = targetStr;
    }

    const targetExpense = await Expense.findOne(query).sort({ date: -1 });

    if (targetExpense) {
      await Expense.findByIdAndDelete(targetExpense._id);
      return client.replyMessage({ 
        replyToken: event.replyToken, 
        messages: [{ type: 'text', text: `🗑️ 成功刪除紀錄！\n已為您移除最近一筆：「${targetExpense.item} ${targetExpense.amount} 元」` }] 
      });
    } else {
      return client.replyMessage({ 
        replyToken: event.replyToken, 
        messages: [{ type: 'text', text: `👀 找不到最近有「${targetStr}」的記帳紀錄喔！請確認後再試一次。` }] 
      });
    }
  }

  // ==========================================
  // 階段 3：處理舊版記帳功能 (格式：項目 金額)
  // ==========================================
  if (parts.length === 2 && !isNaN(parts[1])) {
    const newExpense = new Expense({ userId: userId, item: parts[0], amount: parseInt(parts[1], 10) });
    await newExpense.save(); 
    return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `✅ 記帳成功：${parts[0]} 花了 ${parts[1]} 元。\n\n💡 若輸入錯誤，可輸入「刪除 ${parts[0]}」。` }] });
  }

  // ==========================================
  // 階段 4：防呆機制
  // ==========================================
  return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `老闆，我聽不懂 QQ。\n請使用下方選單操作！` }] });
}

app.listen(port, () => { console.log(`Server running on port ${port}`); });