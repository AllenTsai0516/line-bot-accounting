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

  // --- 功能 1：查總帳 ---
  if (userMessage === '查帳') {
    const results = await Expense.aggregate([
      { $match: { userId: userId } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const total = results.length > 0 ? results[0].total : 0;
    return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `💰 您目前的總支出為：${total} 元。` }] });
  }

  // --- 功能 2：查看明細 (總表) ---
  if (userMessage === '總表') {
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

  // --- 功能 3：記帳 ---
  if (parts.length === 2 && !isNaN(parts[1])) {
    const newExpense = new Expense({ userId: userId, item: parts[0], amount: parseInt(parts[1], 10) });
    await newExpense.save(); 
    return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `✅ 記帳成功：${parts[0]} 花了 ${parts[1]} 元。` }] });
  }

  return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `老闆，請輸入「項目 金額」、「查帳」或「總表」。` }] });
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
console.log('強制更新拉！');