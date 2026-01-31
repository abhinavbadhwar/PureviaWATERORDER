require("dotenv").config();
const { google } = require("googleapis");

const http = require("http");
const fs = require("fs");
const path = require("path");
const cancelOtpStore = {};
const nodemailer = require("nodemailer");
const url = require("url");
const readline = require("readline");


function getPendingOrdersOnly(user) {
  if (!user || !user.orders) return [];

  return user.orders.filter(order =>
    order.status === "ACTIVE" &&
    order.delivered !== true
  );
}

// ================= EMAIL SETUP =================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});
// ================= GOOGLE SHEETS SETUP =================
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, "service-account.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

const SHEET_ID = "1ruDhNGWN_Ne3dvPQyY5y2ETaz1Iss8NU8wRpb8KmK08";
const SHEET_NAME = "Sheet1";


transporter.verify(err => {
  if(err) console.error("❌ Email error:", err);
  else console.log("✅ Email server ready");
});

function sendEmail(to, subject, html, extra={}) {
  return transporter.sendMail({
    from: `"Purevia 💧" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
    ...extra
  });
}

// ================= HELPER MAIL FUNCTIONS =================

  async function sendDeliveredMail(to, name) {

    // STEP A: make sure CONFIRMED = YES
    await confirmOrderInSheet(to);
  
    // STEP B: send delivery email
    await sendEmail(
      to,
      "💙 Your Purevia Order is Delivered!",
      `
        <h2>Hey ${name},</h2>
        <p>Your order has been delivered 🚚💧</p>
      `
    );
  
    // STEP C: mark DELIVERED = YES
    await markDeliveredInSheet(to);
  }
  
  

async function sendReviewMail(to, name) {
  await sendEmail(
    to,
    "⭐ We'd Love Your Review!",
    `
      <h2>Hi ${name},</h2>
      <p>Your feedback means the world to us 💙</p>
      <p>Please reply to this email and share:</p>
      <ul>
        <li>Water quality 💧</li>
        <li>Delivery experience 🚚</li>
        <li>Overall satisfaction ⭐</li>
      </ul>
      <p>Thank you for choosing Purevia!</p>
    `,
    { replyTo: process.env.MY_EMAIL }
  );
  console.log(`✅ Review request mail sent to ${to}`);
}

async function sendOutForDeliveryMail(to, name) {
  await sendEmail(
    to,
    "🚚 Your Purevia Order is Out for Delivery!",
    `
      <h2>Hi ${name},</h2>
      <p>Your Purevia water is now <strong>out for delivery</strong>! 💧🚚</p>
      <p>It will reach you shortly. Please keep your phone nearby for updates.</p>
      <p>💧 Stay hydrated! Team Purevia</p>
    `
  );
  console.log(`✅ Out-for-delivery mail sent to ${to}`);
}
async function sendCancelledMail(to, name) {
  await sendEmail(
    to,
    "❌ Your Purevia Order Has Been Cancelled",
    `
      <h2>Hi ${name},</h2>
      <p>We’re sorry to inform you that your Purevia order has been <strong>cancelled</strong>.</p>
      <p>If this was a mistake or you need help, feel free to reply to this email.</p>
      <p>💧 Team Purevia</p>
    `
  );

  console.log(`❌ Cancellation mail sent to ${to}`);
}


// ================= SAVE ORDER TO GOOGLE SHEET =================
async function saveOrderToSheet(order) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:I`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        order.name || "",
        order.email || "",
        order.mobile || "",
        order.address || "",
        order.totalPrice || 0,
        order.paymentMethod || "",
        "NO",        // CONFIRMED
        "NO",        // DELIVERED
        "ACTIVE"     // STATUS
      ]]
    }
  });
}
async function confirmOrderInSheet(email) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:I`
  });

  const rows = res.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === email && rows[i][8] !== "CANCELLED") {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!G${i + 1}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["YES"]] }
      });
      return;
    }
  }
}


// ================= MARK ORDER AS DELIVERED =================
async function markDeliveredInSheet(email) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:I`
  });

  const rows = res.data.values || [];

  for (let i = 1; i < rows.length; i++) {

    // 🔍 DEBUG LOG (ADD THIS LINE)
    console.log("🔍 Checking row", i + 1, ":", rows[i]);

    if (
      rows[i][1] === email &&
      rows[i][6] === "YES" &&
      rows[i][8] !== "CANCELLED"
    ) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!H${i + 1}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["YES"]] }
      });

      console.log("✅ Delivered marked YES for row", i + 1);
      return;
    }
  }

  throw "Order not confirmed or already cancelled";
}

// ================= MARK ORDER AS CANCELLED (COLUMN H) =================



async function markCancelledInSheet(email) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:I`
  });

  const rows = res.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    if (
      rows[i][1] === email &&
      rows[i][6] === "YES" &&     // confirmed
      rows[i][7] !== "YES" &&     // not delivered
      rows[i][8] !== "CANCELLED" // not cancelled
    ) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!I${i + 1}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [["CANCELLED"]]
        }
      });

      console.log("❌ Order cancelled for row", i + 1);
      return;
    }
  }
}




// ================= OTP STORE =================
const otpStore = {}; // { email: { otp, expires } }
const deliveryOtpStore = {}; 
// { email: { otp, expires } }


// ================= SERVER =================
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // ---------- GET PAGES ----------
  if(req.method === "GET") {
    let file = "";
    if(parsedUrl.pathname === "/") file = "ss.html";
    else if(parsedUrl.pathname === "/cart") file = "cart.html";
    else if(parsedUrl.pathname === "/delivery") file = "delivery.html";
    else if(parsedUrl.pathname === "/cancel") file = "cancel.html";




    if(file){
      const filePath = path.join(__dirname, file);
      fs.readFile(filePath, (err, data) => {
        if(err){
          res.writeHead(500, { "Content-Type":"text/plain" });
          return res.end("Error loading file");
        }
        res.writeHead(200, { "Content-Type":"text/html" });
        res.end(data);
      });
      return;
    }
  }

  // ---------- POST REQUESTS ----------
  if(req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try{
        const data = JSON.parse(body);
        // ===== SEND DELIVERY OTP =====
if (req.url === "/send-delivery-otp") {
  if (!data.email || !data.name) throw "Email or name missing";

  const otp = Math.floor(1000 + Math.random() * 9000).toString();

  deliveryOtpStore[data.email] = {
    otp,
    expires: Date.now() + 10 * 60 * 1000 // 10 min
  };

  await sendEmail(
    data.email,
    "🚚 Purevia Delivery OTP",
    `
      <h2>Hi ${data.name},</h2>
      <p>Your <strong>delivery confirmation OTP</strong> is:</p>
      <h1>${otp}</h1>
      <p>Please share this OTP with the delivery person.</p>
      <p>💧 Team Purevia</p>
    `
  );

  res.writeHead(200, { "Content-Type": "application/json" });
  return res.end(JSON.stringify({ success: true }));
}
// ===== VERIFY DELIVERY OTP =====
if (req.url === "/verify-delivery-otp") {
  if (!data.email || !data.otp || !data.name)
    throw "Email, OTP or name missing";

  const record = deliveryOtpStore[data.email];
  if (!record) throw "Delivery OTP not generated";
  if (Date.now() > record.expires) throw "Delivery OTP expired";
  if (record.otp !== data.otp) throw "Invalid Delivery OTP";

  delete deliveryOtpStore[data.email]; // OTP used

  // ✅ NOW delivery is CONFIRMED
  
  await sendDeliveredMail(data.email, data.name);

// 🔽 ADD THIS BELOW
const usersFile = path.join(__dirname, "users.json");
const users = JSON.parse(fs.readFileSync(usersFile));
const user = users.find(u => u.email === data.email);

if (user) {
  const order = user.orders
    .filter(o => o.status === "ACTIVE" && o.delivered === false)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

  if (order) {
    order.delivered = true;
    order.status = "DELIVERED";
  }

  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}


  res.writeHead(200, { "Content-Type": "application/json" });
  return res.end(JSON.stringify({
    success: true,
    message: "Delivery confirmed successfully"
  }));
}
if (req.url === "/send-cancel-otp") {
  if (!data.email) throw "Email missing";

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  cancelOtpStore[data.email] = {
    otp,
    expires: Date.now() + 5 * 60 * 1000
  };

  await sendEmail(
    data.email,
    "❌ Purevia Cancel Order OTP",
    `<h2>Your OTP is ${otp}</h2><p>Valid for 5 minutes</p>`
  );

  res.writeHead(200, { "Content-Type": "application/json" });
  return res.end(JSON.stringify({ success: true }));
}
if (req.url === "/verify-cancel-otp") {
  const { email, otp } = data;
  const record = cancelOtpStore[email];

  if (!record) throw "OTP not sent";
  if (Date.now() > record.expires) throw "OTP expired";
  if (record.otp !== otp) throw "Invalid OTP";

  delete cancelOtpStore[email];

  const usersFile = path.join(__dirname, "users.json");
  const users = JSON.parse(fs.readFileSync(usersFile));
  const user = users.find(u => u.email === email);

  res.writeHead(200, { "Content-Type": "application/json" });
  const pendingOrders = getPendingOrdersOnly(user)
  .sort((a, b) => new Date(b.date) - new Date(a.date));


return res.end(JSON.stringify({
  success: true,
  orders: pendingOrders
}));

}
if (req.url === "/delete-order") {
  const { email, index } = data;

  const usersFile = path.join(__dirname, "users.json");
  let users = [];
  if (fs.existsSync(usersFile)) {
    users = JSON.parse(fs.readFileSync(usersFile));
  }

  const user = users.find(u => u.email === email);
  if (!user || !user.orders[index]) throw "Order not found";

  user.orders[index].status = "CANCELLED";
  user.orders[index].cancelledAt = new Date().toISOString();
  
  await markCancelledInSheet(email);
  
  // 📧 SEND CANCELLATION EMAIL
  await sendCancelledMail(email, user.name || "Customer");
  
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  

  res.writeHead(200, { "Content-Type": "application/json" });
  return res.end(JSON.stringify({ success: true }));
}
// ---------- NOTIFY ADMIN & SEND DELIVERY OTP ----------
if(req.url === "/notify-delivery-start") {
  const { email, name } = data;
  if(!email || !name) throw "Email or name missing";

  // 1️⃣ Notify admin
  if(process.env.MY_EMAIL){
    await sendEmail(
      process.env.MY_EMAIL,
      "🚚 Delivery Started Notification",
      `
        <h2>Delivery Boy Notification</h2>
        <p>The delivery person has reached the customer location.</p>
        <ul>
          <li><strong>Name:</strong> ${name}</li>
          <li><strong>Email:</strong> ${email}</li>
        </ul>
      `
    );
    console.log(`✅ Admin notified for delivery start: ${email}`);
  }

  // 2️⃣ Generate delivery OTP
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  deliveryOtpStore[email] = {
    otp,
    expires: Date.now() + 10 * 60 * 1000 // 10 minutes
  };

  // 3️⃣ Send OTP to customer
  await sendEmail(
    email,
    "🚚 Your Purevia Delivery OTP",
    `
      <h2>Hi ${name},</h2>
      <p>Your <strong>delivery confirmation OTP</strong> is:</p>
      <h1>${otp}</h1>
      <p>Please share this OTP with the delivery person to confirm delivery.</p>
      <p>💧 Team Purevia</p>
    `
  );

  res.writeHead(200, { "Content-Type":"application/json" });
  return res.end(JSON.stringify({ success:true, message:"Admin notified & delivery OTP sent" }));
}



        // ===== SEND OTP =====
        if(req.url === "/send-otp") {
          if(!data.email) throw "Email missing";
          const otp = Math.floor(100000 + Math.random()*900000).toString();
          otpStore[data.email] = { otp, expires: Date.now() + 5*60*1000 };

          await sendEmail(data.email, "Your Purevia OTP", `
            <h2>Hello ${data.name || "Customer"},</h2>
            <p>Your OTP for placing an order on Purevia is:</p>
            <h1>${otp}</h1>
            <p>This OTP is valid for 5 minutes.</p>
            <p>💧 Stay hydrated! Team Purevia</p>
          `);

          res.writeHead(200, { "Content-Type":"application/json" });
          return res.end(JSON.stringify({ success:true }));
        }

        // ===== PLACE ORDER =====
        if(req.url === "/order") {
          if(!data.email || !data.otp) throw "Email or OTP missing";

          const record = otpStore[data.email];
          if(!record) throw "OTP not sent";
          if(Date.now() > record.expires) throw "OTP expired";
          if(data.otp !== record.otp) throw "Invalid OTP";

          delete otpStore[data.email]; // OTP verified
           // OTP verified



await sendEmail(data.email, "🎉 Order Confirmed", `
  <h2>Hi ${data.name},</h2>
  <p>Your order is confirmed and will be delivered soon 💧</p>
`);


          // Save order in users.json
          let users = [];
          const usersFile = path.join(__dirname, "users.json");
          if(fs.existsSync(usersFile)) users = JSON.parse(fs.readFileSync(usersFile));

          let user = users.find(u => u.email === data.email);
          if(!user){
            user = { email: data.email, name: data.name || "", mobile: data.mobile || "", orders: [] };
            users.push(user);
          }

          user.orders.push({
            orderId: "ORD-" + Date.now(),   // ✅ identity
            items: data.items,
            totalPrice: data.totalPrice,
            delivery: data.delivery,
            address: data.address,
            paymentMethod: data.paymentMethod,
            date: new Date().toISOString(),
            status: "ACTIVE" ,
            delivered: false               // ✅ meaning
          });
          

          fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

          // Send emails
         // 1️⃣ Save order to sheet
await saveOrderToSheet(data);

// 2️⃣ Confirm it immediately
await confirmOrderInSheet(data.email);

// 3️⃣ Optional admin mail
if(process.env.MY_EMAIL){
  await sendEmail(
    process.env.MY_EMAIL,
    "🧃 New Purevia Order",
    `<pre>${JSON.stringify(data, null, 2)}</pre>`
  );
}


          await sendEmail(data.email, "🎉 Your Purevia Order is Confirmed", `
            <h2>Hi ${data.name || "Customer"},</h2>
            <p>Your order has been successfully placed!</p>
            <p><strong>Total:</strong> ₹${data.totalPrice}</p>
            <p>We will notify you when your order is packed, out for delivery, and delivered.</p>
            <p>💧 Team Purevia</p>
          `);

          res.writeHead(200, { "Content-Type":"application/json" });
          return res.end(JSON.stringify({ success:true }));
        }

        // ===== SEND DELIVERY MAIL (via POST request) =====
        if(req.url === "/send-delivered-mail"){
          if(!data.email || !data.name) throw "Email or name missing";
          await sendDeliveredMail(data.email, data.name);
          res.writeHead(200, { "Content-Type":"application/json" });
          return res.end(JSON.stringify({ success:true }));
        }

        // ===== SEND REVIEW REQUEST MAIL =====
        if(req.url === "/send-review-mail"){
          if(!data.email || !data.name) throw "Email or name missing";
          await sendReviewMail(data.email, data.name);
          res.writeHead(200, { "Content-Type":"application/json" });
          return res.end(JSON.stringify({ success:true }));
        }

        // ===== SEND OUT-FOR-DELIVERY MAIL (via POST request) =====
        if(req.url === "/send-out-delivery-mail"){
          if(!data.email || !data.name) throw "Email or name missing";
          await sendOutForDeliveryMail(data.email, data.name);
          res.writeHead(200, { "Content-Type":"application/json" });
          return res.end(JSON.stringify({ success:true }));
        }

      } catch(err){
        console.error(err);
        res.writeHead(400, { "Content-Type":"application/json" });
        return res.end(JSON.stringify({ success:false, msg: err.toString() }));
      }
    });
  } else {
    res.writeHead(404, { "Content-Type":"text/plain" });
    res.end("Not Found");
  }
});

// ================= PORT =================
server.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${process.env.PORT || 3000}`);
});


// ================= TERMINAL INTERACTIVE COMMANDS =================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("💧 Type 'D' = Delivered mail, 'R' = Review mail, 'O' = Out-for-Delivery mail");

rl.on("line", (input) => {
  const cmd = input.trim().toUpperCase();

  if(cmd === "D" || cmd === "R" || cmd === "O"){
    rl.question("Enter customer email: ", (email) => {
      if(!email) { console.log("❌ Email cannot be empty"); return; }

      rl.question("Enter customer name: ", async (name) => {
        if(!name) name = "Customer";

        try{
          if(cmd === "D") await sendDeliveredMail(email, name);
          else if(cmd === "R") await sendReviewMail(email, name);
          else if(cmd === "O") await sendOutForDeliveryMail(email, name);
        } catch(err){
          console.error("❌ Error sending mail:", err);
        }

        console.log("\n💧 Type 'D' = Delivered mail, 'R' = Review mail, 'O' = Out-for-Delivery mail");
      });
    });
  } else {
    console.log("❌ Invalid command. Type 'D', 'R', or 'O'.");
  }
});