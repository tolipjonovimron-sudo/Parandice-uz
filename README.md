import express from "express";
import bcrypt from "bcrypt";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import fs from "fs";
import jwt from "jsonwebtoken";
import cron from "node-cron";

const app = express();
const PORT = process.env.PORT || 10000;
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
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  if (!fs.existsSync("public")) fs.mkdirSync("public");
  fs.writeFileSync("public/index.html", `
<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Parandice.uz</title>
<style>
body{font-family:Arial;margin:0;padding:0;background:#121212;color:#fff;}
header{background:#1f1f1f;padding:15px;text-align:center;font-size:1.5em;}
.container{padding:15px;}
input,button,select{width:100%;padding:10px;margin:5px 0;border-radius:8px;border:none;font-size:1em;}
button{background:#4CAF50;color:#fff;cursor:pointer;}
button:hover{background:#45a049;}
.task,.transaction{background:#1f1f1f;padding:10px;margin:5px 0;border-radius:8px;}
h2,h3{margin:10px 0 5px;}
</style>
</head>
<body>
<header>Parandice.uz 🎉</header>
<div class="container" id="auth">
<h2>Ro‘yxatdan o‘tish</h2>
<input id="regUser" placeholder="Username">
<input id="regPass" type="password" placeholder="Password">
<input id="referralCode" placeholder="Taklif kodi (ixtiyoriy)">
<button onclick="register()">Ro‘yxatdan o‘tish</button>
<h2>Kirish</h2>
<input id="loginUser" placeholder="Username">
<input id="loginPass" type="password" placeholder="Password">
<button onclick="login()">Kirish</button>
</div>
<div class="container" id="dashboard" style="display:none;">
<h2>Salom, <span id="username"></span>!</h2>
<p>Balans: <span id="balance">0</span> so'm</p>

<h3>Avtomobil sotib olish</h3>
<select id="carModel">
  <option value="1">Avto1 – 50,000 UZS, kunlik 5,000, 90 kun</option>
  <option value="2">Avto2 – 150,000 UZS, kunlik 10,000, 90 kun</option>
  <option value="3">Avto3 – 215,000 UZS, kunlik 25,000, 90 kun</option>
  <option value="4">Avto4 – 480,000 UZS, kunlik 35,000, 90 kun</option>
  <option value="5">Avto5 – 700,000 UZS, kunlik 55,000, 90 kun</option>
</select>
<button onclick="buyCar()">Sotib olish</button>

<h3>Depozit</h3>
<input id="depositAmount" type="number" placeholder="Summa">
<button onclick="deposit()">Depozit qilish</button>

<h3>Pul yechish</h3>
<input id="withdrawAmount" type="number" placeholder="Summa">
<button onclick="withdraw()">Pul yechish</button>

<h3>Tranzaksiyalar</h3>
<div id="transactions"></div>

<h3>Yordam</h3>
<p>Admin bilan bog‘lanish: <a href="mailto:admin@parandice.uz">admin@parandice.uz</a></p>

<h3>Ilovani yuklash (Android)</h3>
<p><a href="#">Ilovani yuklab olish</a></p>

<button onclick="logout()">Chiqish</button>
</div>
<script>
let token="", username="";
async function register(){
  const res=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    username:document.getElementById("regUser").value,
    password:document.getElementById("regPass").value,
    referral:document.getElementById("referralCode").value
  })});
  const data=await res.json();
  alert(data.message||data.error);
}
async function login(){
  const res=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    username:document.getElementById("loginUser").value,
    password:document.getElementById("loginPass").value
  })});
  const data=await res.json();
  if(data.token){
    token=data.token; username=document.getElementById("loginUser").value;
    document.getElementById("auth").style.display="none";
    document.getElementById("dashboard").style.display="block";
    document.getElementById("username").innerText=username;
    document.getElementById("balance").innerText=data.balance;
    loadTransactions();
  }else{alert(data.error);}
}
async function buyCar(){
  const model=parseInt(document.getElementById("carModel").value);
  const res=await fetch("/api/buyCar",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({model})});
  const data=await res.json();
  alert(data.message||data.error);
  if(data.success) document.getElementById("balance").innerText=data.balance;
  loadTransactions();
}
async function deposit(){
  const amount=parseFloat(document.getElementById("depositAmount").value);
  if(amount<=0) return alert("Iltimos, to‘g‘ri summa kiriting");
  const res=await fetch("/api/deposit",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({amount})});
  const data=await res.json();
  alert(data.message||data.error);
  if(data.success) document.getElementById("balance").innerText=data.balance;
  loadTransactions();
}
async function withdraw(){
  const amount=parseFloat(document.getElementById("withdrawAmount").value);
  if(amount<=0) return alert("Iltimos, to‘g‘ri summa kiriting");
  const res=await fetch("/api/withdraw",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({amount})});
  const data=await res.json();
  alert(data.message||data.error);
  loadTransactions();
}
async function loadTransactions(){
  const res=await fetch("/api/transactions",{headers:{"Authorization":"Bearer "+token}});
  const data=await res.json();
  const div=document.getElementById("transactions"); div.innerHTML="";
  data.transactions.forEach(tx=>{
    const status=tx.status==="pending"?"⏳":"✅";
    div.innerHTML+=\`<div class="transaction">\${tx.type} : \${tx.amount} so'm [\${status}]</div>\`;
  });
}
function logout(){token="";username="";document.getElementById("auth").style.display="block";document.getElementById("dashboard").style.display="none";}
</script>
</body>
</html>
  `);
})();

// JWT middleware
const auth = async (req,res,next)=>{
  const token=req.headers.authorization?.split(" ")[1];
  if(!token) return res.status(401).json({error:"Token mavjud emas"});
  try{req.user=jwt.verify(token,JWT_SECRET);next();}catch{res.status(401).json({error:"Token noto‘g‘ri"});}
};

// Avto narxlari va daromad
const carData = {
  1:{price:50000,daily:5000,days:90},
  2:{price:150000,daily:10000,days:90},
  3:{price:215000,daily:25000,days:90},
  4:{price:480000,daily:35000,days:90},
  5:{price:700000,daily:55000,days:90}
};

// APIlar
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

app.post("/api/login", async (req,res)=>{
  const {username,password}=req.body;
  const user=await db.get("SELECT * FROM users WHERE username=?",[username]);
  if(!user) return res.status(400).json({error:"Foydalanuvchi topilmadi"});
  const valid=await bcrypt.compare(password,user.password);
  if(!valid) return res.status(400).json({error:"Parol xato"});
  const token=jwt.sign({id:user.id,username},JWT_SECRET);
  res.json({message:"Kirish muvaffaqiyatli",token,balance:user.balance});
});

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

// Depozit va Pul yechish (10:00–22:00)
const checkTime = ()=>{const d=new Date();const h=d.getHours();return h>=10 && h<=22;};

app.post("/api/deposit",auth, async (req,res)=>{
  if(!checkTime()) return res.status(400).json({error:"Depozit faqat 10:00–22:00"});
  const amount=parseFloat(req.body.amount);
  if(amount<=0) return res.status(400).json({error:"Noto‘g‘ri summa"});
  await db.run("UPDATE users SET balance=balance+? WHERE id=?",[amount,req.user.id]);
  await db.run("INSERT INTO transactions (user_id,type,amount,status)
