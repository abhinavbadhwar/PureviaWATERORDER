require('dotenv').config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

// ================= MAIL SETUP =================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

transporter.verify((err, success) => {
  if(err) console.log("❌ Email verification error:", err);
  else console.log("✅ Server ready to send emails!");
});

// ================= SERVER =================
const server = http.createServer((req, res) => {

  // Serve HTML
  if(req.url === "/" && req.method === "GET"){
    const filePath = path.join(__dirname, "ss.html");
    fs.readFile(filePath, (err, data) => {
      if(err){
        res.writeHead(500, {"Content-Type":"text/plain"});
        res.end("Error loading file");
        return;
      }
      res.writeHead(200, {"Content-Type":"text/html"});
      res.end(data);
    });
  }

  // Handle order POST
  else if(req.url === "/order" && req.method === "POST"){
    let body = "";
    req.on("data", chunk => body += chunk.toString());
    req.on("end", () => {
      let order;
      try {
        order = JSON.parse(body);
      } catch(e){
        res.writeHead(400, {"Content-Type":"application/json"});
        res.end(JSON.stringify({ success: false, error: "Invalid JSON" }));
        return;
      }

      // Prepare email
      const mailOptions = {
        from: `"Purevia Orders" <${process.env.EMAIL_USER}>`,
        to: process.env.MY_EMAIL,
        subject: `🧃 New Water Order from ${order.name || order.mobile}`,
        text: `
✅ New Order Received!

Customer Name: ${order.name}
Mobile: ${order.mobile}
Bottle Size: ${order.size}
Total Bottles: ${order.totalBottles}
Total Price: ₹${order.totalPrice}

Delivery Type: ${order.delivery}
Address:
${order.address}

Extra Notes:
${order.notes || "-"}

Time: ${new Date().toLocaleString()}
        `
      };

      transporter.sendMail(mailOptions, (err, info) => {
        if(err){
          console.error("❌ Email error:", err);
          res.writeHead(500, {"Content-Type":"application/json"});
          res.end(JSON.stringify({ success: false, error: err.message }));
        } else {
          console.log("✅ Order email sent:", info.response);
          res.writeHead(200, {"Content-Type":"application/json"});
          res.end(JSON.stringify({ success: true }));
        }
      });
    });
  }

  // 404 Not Found
  else {
    res.writeHead(404, {"Content-Type":"text/plain"});
    res.end("Not Found");
  }

});

server.listen(3000, () => console.log("🚀 Server running at http://localhost:3000"));
