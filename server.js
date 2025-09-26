import express from "express";
import bcrypt from "bcrypt";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import fs from "fs";
import jwt from "jsonwebtoken";
import cron from "node-cron";

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_for_jwt";

app.use(express.json());
app.use(express.static("public"));

let db;
(async () => {
  db = await open({ filename: "./database.sqlite", driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      balance REAL DEFAULT 0,
      referral_code TEXT,
      referrer TEXT
    );
    CREATE TABLE IF NOT EXISTS cars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      model TEXT,
      daily_income REAL,
      remaining_days INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT,
      amount REAL,
      status TEXT DEFAULT 'pending',
      card_number TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  if (!fs.existsSync("public")) fs.mkdirSync("public");
  fs.writeFileSync("public/index.html", "<h1>Parandice.uz ishga tushdi 🚀</h1>");
})();

// JWT middleware
const auth = async (req,res,next)=>{
  const token=req.headers.authorization?.split(" ")[1];
  if(!token) return res.status(401).json({error:"Token mavjud emas"});
  try{req.user=jwt.verify(token,JWT_SECRET);next();}catch{res.status(401).json({error:"Token noto‘g‘ri"});}
};

// Avto narxlari
const carData = {
  1:{price:50000,daily:5000,days:90},
  2:{price:150000,daily:10000,days:90},
  3:{price:215000,daily:25000,days:90},
  4:{price:480000,daily:35000,days:90},
  5:{price:700000,daily:55000,days:90}
};

// Ro‘yxatdan o‘tish
app.post("/api/register", async (req,res)=>{
  const {username,password,referral}=req.body;
  if(!username||!password) return res.status(400).json({error:"Username va parol kerak"});
  const hashed=await bcrypt.hash(password,10);
  try{
    const result = await db.run("INSERT INTO users (username,password,referrer) VALUES (?,?,?)",[username,hashed,referral||null]);
    const token = jwt.sign({id:result.lastID,username},JWT_SECRET);
    res.json({message:"Ro‘yxatdan o‘tildi", token, balance:0});
  }catch{res.status(400).json({error:"Bunday foydalanuvchi mavjud"});}
});

// Login
app.post("/api/login", async (req,res)=>{
  const {username,password}=req.body;
  const user=await db.get("SELECT * FROM users WHERE username=?",[username]);
  if(!user) return res.status(400).json({error:"Foydalanuvchi topilmadi"});
  const valid=await bcrypt.compare(password,user.password);
  if(!valid) return res.status(400).json({error:"Parol xato"});
  const token=jwt.sign({id:user.id,username},JWT_SECRET);
  res.json({message:"Kirish muvaffaqiyatli",token,balance:user.balance});
});

// Mashina sotib olish
app.post("/api/buyCar",auth, async (req,res)=>{
  const model=parseInt(req.body.model);
  if(!carData[model]) return res.status(400).json({error:"Model topilmadi"});
  const user=await db.get("SELECT * FROM users WHERE id=?",[req.user.id]);
  if(user.balance<carData[model].price) return res.status(400).json({error:"Balans yetarli emas"});
  await db.run("UPDATE users SET balance=balance-? WHERE id=?",[carData[model].price,req.user.id]);
  await db.run("INSERT INTO cars (user_id,model,daily_income,remaining_days) VALUES (?,?,?,?)",[req.user.id,"Avto"+model,carData[model].daily,carData[model].days]);
  await db.run("INSERT INTO transactions (user_id,type,amount,status) VALUES (?,?,?,'completed')",[req.user.id,"buy_car",carData[model].price]);
  const newBalance=await db.get("SELECT balance FROM users WHERE id=?",[req.user.id]);
  res.json({success:true,message:"Avtomobil sotib olindi",balance:newBalance.balance});
});

// Depozit
app.post("/api/deposit",auth, async (req,res)=>{
  const amount=parseFloat(req.body.amount);
  if(amount<=0) return res.status(400).json({error:"Noto‘g‘ri summa"});
  await db.run("UPDATE users SET balance=balance+? WHERE id=?",[amount,req.user.id]);
  await db.run("INSERT INTO transactions (user_id,type,amount,status) VALUES (?,?,?,'completed')",[req.user.id,"deposit",amount]);
  const newBalance=await db.get("SELECT balance FROM users WHERE id=?",[req.user.id]);
  res.json({success:true,message:"Depozit qo‘shildi",balance:newBalance.balance});
});

// Pul yechish (karta raqami bilan)
app.post("/api/withdraw",auth, async (req,res)=>{
  const amount=parseFloat(req.body.amount);
  const card=req.body.card;
  if(amount<=0) return res.status(400).json({error:"Noto‘g‘ri summa"});
  const user=await db.get("SELECT * FROM users WHERE id=?",[req.user.id]);
  if(user.balance<amount) return res.status(400).json({error:"Balans yetarli emas"});
  await db.run("UPDATE users SET balance=balance-? WHERE id=?",[amount,req.user.id]);
  await db.run("INSERT INTO transactions (user_id,type,amount,status,card_number) VALUES (?,?,?,'pending',?)",[req.user.id,"withdraw",amount,card]);
  res.json({success:true,message:"Pul yechish so‘rovi yuborildi. Admin tasdiqlashi kerak."});
});

// Tranzaksiyalar
app.get("/api/transactions",auth, async (req,res)=>{
  const tx=await db.all("SELECT * FROM transactions WHERE user_id=?",[req.user.id]);
  res.json({transactions:tx});
});

// Cron job – har kuni 00:00 da foydalanuvchilarga daromad yozish
cron.schedule("0 0 * * *", async ()=>{
  const cars=await db.all("SELECT * FROM cars");
  for(const car of cars){
    if(car.remaining_days>0){
      await db.run("UPDATE users SET balance=balance+? WHERE id=?",[car.daily_income,car.user_id]);
      await db.run("UPDATE cars SET remaining_days=remaining_days-1 WHERE id=?",[car.id]);
    }
  }
});

app.listen(PORT,()=>console.log("Server ishlayapti: http://localhost:"+PORT));