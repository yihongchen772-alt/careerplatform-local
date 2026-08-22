// One-off seed script for the verified company directory.
// Run against local: DATABASE_URL=... node prisma/seed-companies.js
// Run against production: DATABASE_URL=<neon-unpooled-url> node prisma/seed-companies.js
const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();

const companies = [
  { name: "字节跳动", careerUrl: "https://jobs.bytedance.com/campus/position", sector: "互联网", industry: "互联网/内容平台" },
  { name: "腾讯", careerUrl: "https://join.qq.com/", sector: "互联网", industry: "互联网/社交娱乐" },
  { name: "阿里巴巴", careerUrl: "https://talent.alibaba.com/", sector: "互联网", industry: "互联网/电商云计算" },
  { name: "百度", careerUrl: "https://talent.baidu.com/external/baidu/index.html", sector: "互联网", industry: "互联网/搜索AI" },
  { name: "美团", careerUrl: "https://zhaopin.meituan.com/", sector: "互联网", industry: "互联网/本地生活" },
  { name: "京东", careerUrl: "https://zhaopin.jd.com/", sector: "互联网", industry: "互联网/电商物流" },
  { name: "拼多多", careerUrl: "https://careers.pinduoduo.com/", sector: "互联网", industry: "互联网/电商" },
  { name: "网易", careerUrl: "https://hr.163.com/", sector: "互联网", industry: "互联网/游戏内容" },
  { name: "小米", careerUrl: "https://hr.xiaomi.com/campus", sector: "科技", industry: "消费电子/硬件" },
  { name: "华为", careerUrl: "https://career.huawei.com/reccampportal/portal5/campus-recruitment.html", sector: "科技", industry: "通信/ICT" },
  { name: "滴滴", careerUrl: "https://talent.didiglobal.com/", sector: "互联网", industry: "互联网/出行" },
  { name: "哔哩哔哩", careerUrl: "https://jobs.bilibili.com/campus", sector: "互联网", industry: "互联网/内容社区" },
  { name: "携程", careerUrl: "https://careers.ctrip.com/", sector: "消费/服务业", industry: "在线旅游" },
  { name: "比亚迪", careerUrl: "https://job.byd.com/portal/pc/", sector: "制造业", industry: "汽车/新能源" },
  { name: "宁德时代", careerUrl: "https://talent.catl.com/", sector: "制造业", industry: "新能源/电池" },
  { name: "美的", careerUrl: "https://careers.midea.com/", sector: "制造业", industry: "家电/智能制造" },
  { name: "招商银行", careerUrl: "https://career.cmbchina.com/", sector: "金融", industry: "银行" },
  { name: "中国平安", careerUrl: "https://campus.pingan.com/", sector: "金融", industry: "保险/综合金融" },
  { name: "顺丰", careerUrl: "https://campus.sf-express.com/index.html", sector: "物流", industry: "物流快递" },
];

async function main() {
  for (const c of companies) {
    await db.company.upsert({
      where: { name: c.name },
      update: {
        careerUrl: c.careerUrl,
        sector: c.sector,
        industry: c.industry,
        verified: true,
      },
      create: {
        name: c.name,
        careerUrl: c.careerUrl,
        sector: c.sector,
        industry: c.industry,
        verified: true,
      },
    });
    console.log(`upserted: ${c.name}`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
