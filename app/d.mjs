import { chromium } from "playwright";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1200}});
await p.goto("http://localhost:4420",{waitUntil:"networkidle"}); await p.waitForTimeout(6000);
const t=await p.innerText("body");
console.log("--- first 700 chars ---\n"+t.slice(0,700));
