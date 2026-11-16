# PIE-Bench 图像编辑 · 在线人工评测

50 个样本 × 7 个方法。请你为每个方法的编辑结果判断「成功 / 失败」，并选出整体最好的一个。
约 35–45 分钟。

**不需要安装任何东西，打开网页即可。**

---

## 目录内容

```
.
├── index.html          单页应用（纯 HTML/CSS/JS，无框架）
├── data/panel.js       样本、方法、指令；每屏顺序由 hash(rater, sample) 决定
├── img/
│   ├── orig/           50 张原图
│   └── <method>/       7 个方法各自的 50 张结果（350 张）
├── worker/             可选：收票后端（Cloudflare Worker）
├── .nojekyll           告诉 GitHub Pages 不要跑 Jekyll
└── README.md           本文件
```

全部使用相对路径，所以放在域名根目录或 `https://<user>.github.io/<repo>/`
子路径都能工作。

---

## 一、部署到 GitHub Pages（不需要任何服务器）

```bash
# 1. 建一个空仓库，比如 piebench-eval，然后在本目录执行
git init
git add -A
git commit -m "PIE-Bench human evaluation (static site)"
git branch -M main
git remote add origin git@github.com:<你的账号>/piebench-eval.git
git push -u origin main
```

```
2. 仓库页面 → Settings → Pages
   Source: Deploy from a branch
   Branch: main    Folder: / (root)
   Save
```

等 1–2 分钟，访问：

```
https://<你的账号>.github.io/piebench-eval/
```

`.nojekyll` 必须保留在仓库根目录，否则 Pages 会用 Jekyll 处理站点。

> 仓库约 76 MB，远低于 GitHub Pages 的 1 GB / 站上限。

---

## 二、票存在哪里

这是唯一需要你决定的事。GitHub Pages 只能发静态文件，**不能接收 POST**，
所以存票有三条路。

### 方案 A：只存浏览器（零后端，适合自测）

当前默认。票写入浏览器 localStorage，刷新不丢，但换浏览器或清缓存就没了，
**别人评的票你也收不到**。

- 适合：自己核对接错、线下一个人评完再导出
- 导出：页面底部「导出我的投票 (JSON)」

### 方案 B：Cloudflare Worker + KV（推荐，真正收票）

免费额度 10 万次/天，不需要维护服务器，票存在 Cloudflare KV 里。

```bash
cd worker
npm create cloudflare@latest -- .     # 或用现成的 wrangler.toml
npx wrangler kv namespace create VOTES
#   把返回的 id 填进 wrangler.toml 的 id = "..."
npx wrangler secret put EXPORT_TOKEN  # 自定义一个长随机串
npx wrangler deploy                   # 得到 https://pie-votes.<acct>.workers.dev
```

然后把 `wrangler.toml` 里的 `ALLOWED_ORIGIN` 改成你的 Pages 域名，
重新 deploy。接着重新构建页面，让它把票 POST 过去：

```bash
# 回到仓库根目录
python ../human_eval_kit/build_public_site.py \
    --out . \
    --endpoint https://pie-votes.<acct>.workers.dev/
git add -A && git commit -m "point votes at worker" && git push
```

导出所有票：

```bash
curl "https://pie-votes.<acct>.workers.dev/export?token=<你的EXPORT_TOKEN>" \
  > votes.ndjson
```

每行一票，可直接被 `human_eval_kit/tools/export.py` 读取（把 `.ndjson` 改成
`.jsonl` 传 `--csv` 前先转一下格式即可）。

**设计要点**

| 项 | 做法 | 原因 |
|---|---|---|
| CORS | 固定 `ALLOWED_ORIGIN`，不用 `*` | 别人无法往你的数据里塞票 |
| 字段 | 白名单过滤 | 客户端无法注入任意键 |
| 体积 | 单票 > 8 KB 拒绝 | 正常一票约 400 B |
| 导出 | 需要 `EXPORT_TOKEN` | 投票数据不公开可读 |
| 有效期 | 180 天 | 够一个审稿周期 |
| 容错 | 页面本地先存，再 POST | 断网不丢票，下次自动重试 |

### 方案 C：其他免费后端

同样的 JSON POST 协议，任何能返回 2xx 的地方都行：

- **Vercel / Netlify Function**：写一个接收 POST 的函数
- **Google Apps Script + Sheets**：直接把票写进表格，适合完全不想碰云的人
- **Supabase / Firebase**：需要开表权限，注意别泄露 key

只要把 URL 传给 `--endpoint` 即可，前端代码不用改。

---

## 三、页面怎么工作

- **匿名性**：7 个方法的显示顺序由 `hash(rater + 样本ID)` 决定。
  同一人刷新顺序不变；不同人顺序不同，因此抄不到别人的答案。
  映射只在浏览器里算，不上传。
- **两票一屏**：每个方法判「成功/失败」，再选「整体最好」（可也选「差不多」）。
- **防误点**：可「撤销上一票」；重复提交同一样本时最后一票生效。
- **快捷键**：图片可点击放大，`Esc` 关闭。
- **尺寸**：右上角 `小/中/大`，按浏览器记住。

---

## 四、常见问题

**Q: 打开是空白页？**
用 `http://` 打开（`file://` 下浏览器会拦截脚本），或确认 Pages 已经构建完
（Actions 里有 `pages build and deployment` 任务）。

**Q: 图片打不开（404）？**
检查 `img/` 是否完整上传。Git 对大小写敏感，方法目录名必须与
`data/panel.js` 里的 `methods` 数组一致。

**Q: 我评到一半换电脑了？**
票存在那台浏览器里。换机器就是新会话（需重新填名字），之前的票仍在旧机器
上——用「导出我的投票」手动合并。用方案 B 则不存在这个问题。

**Q: 别人能用我的地址乱投吗？**
能投，但每票都带 rater 名字。你可以按 rater 名字过滤后丢弃不可信的。方案 B
里可以再加一层邀请码校验。

**Q: 能不能只给人看、不给人投？**
可以，把 `data/panel.js` 里的 `storage` 改成 `local`（已是默认），票就只留在
各自浏览器，不会进你的数据。

---

## 五、数据格式

每票一条 JSON：

```json
{
  "rater": "alice",
  "sid": "b3f1a2c4d5e6f708",
  "sample_id": "000000000003",
  "slots": {"A": "controlar", "B": "gridar", "...": "..."},
  "esr": {"controlar": 1, "gridar": 0, "...": 0},
  "best_slot": "A",
  "best_model": "controlar",
  "ts": "2026-11-16T16:00:00.000Z"
}
```

- `esr`：1 = 成功，0 = 失败
- `best_slot`：`"tie"` 表示差不多，此时 `best_model` 为 `null`
- `sid`：浏览器会话 id，用于识别同一台设备

---

## 六、方法列表

| 目录名 | 显示名 |
|---|---|
| `controlar` | ControlAR |
| `bagel` | BAGEL-7B-MoT |
| `qwen_image_edit` | Qwen-Image-Edit-2511 |
| `step1x_edit` | Step1X-Edit-v1p2 |
| `flux_kontext` | FLUX.1-Kontext-dev |
| `gridar` | GridAR-EditAR |
| `varedit` | VAREdit-8B-512 |

50 个样本按 PIE-Bench 的 10 个编辑类型分层抽样，与 VLM 自动判分使用的是同一批
样本，因此人工票与自动判分可以逐对比较（Cohen's κ / Krippendorff's α）。
