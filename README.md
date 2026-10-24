# magpie-cf-jev

Cloudflare Workers AI 的 Jev / Clef 作为 **magpie 决策模型供应商**（provider id `cf-jev`）的一个插件。

它存在的唯一理由：**绕过 magpie 上游的一个信封 bug**。

## 问题

Workers AI 跑 `typesafe/jev` 时，回答套了两层信封：

```json
{"result": {"state":"Completed", "result": {"model":"jev-1.13.0","answers":{…},"usage":{…}}}, "success": true, …}
```

magpie 的 `provider.DecideAnswer`（`internal/provider/decide_wire.go`）只拆**一层** `result`，于是交给调用方的是 `{"state":"Completed","result":{…}}` —— 顶层没有 `answers`。后果：

- magpie 自己的分类器（`readJev`）读不到答案，`not a System One answer`；
- `/v1/systemone` 的客户端（例如 mbridge 的分类器）读不到 `answers`，落回默认档。

Clef 只有一层信封，所以只测 Clef 时看不出来。

## 这插件怎么修的

magpie 的插件可以声明自己是决策供应商：`config` 钩子里 `decide: true`，模型的 `decides: true`，于是 magpie 把该 provider 的 `Decide` 指向 `plugin://cf-jev/v1`，所有 System One 请求都过插件的 `fetch`。

插件在这个 `fetch` 里调 Cloudflare，**把两层信封拆干净**，只把 `{"model":…,"answers":…,"usage":…}` 交回 magpie。magpie 对 System One 路径不再拆信封（`DecideAnswer` 原样返回），所以答案带着顶层 `answers` 到达 magpie 自己和它的所有客户端。

实测（本机，2026-10-25）：

| 模型 | 插件直连 | 经 magpie `/v1/systemone` |
| --- | --- | --- |
| `cf-jev/typesafe/jev` | 200 · 1.0s | 200 · 1.2s · `keys=[model,answers,usage]` |
| `cf-jev/@cf/cloudflare/clef` | 200 · 0.5s | 200 · 0.5s |
| `cf-jev/@cf/cloudflare/clef-flash` | 200 · 0.4s | 200 · 0.5s |

## 用法

```sh
# 1. 装插件（本地目录，不走 npm）
magpie plugin add ~/workspace/dev/cf-jev-plugin

# 2. 登录，粘贴 Cloudflare API token
#    只做 Workers AI 的 token 可能列不出账号，那就按 "<account id>:<token>" 粘
magpie plugin login cf-jev

# 3. 确认三个决策模型都在，且 decide 探针通过
magpie provider models cf-jev
magpie provider test cf-jev        # ✓ decide … typesafe/jev

# 4. 把分类组指到插件（order：快的在前）
magpie group set mb-classifier \
  models=cf-jev/typesafe/jev,cf-jev/@cf/cloudflare/clef,cf-jev/@cf/cloudflare/clef-flash,typesafe/jev-latest \
  routing=order
```

> `magpie group mb-classifier` 对决策组总是显示 `not served now, skipped` / `no member ready` —— 那是 magpie CLI 的显示假象（它拿「给 agent 的模型目录」查成员，而决策模型本来就不在里面），不代表插件不能用。真要看可用性：`magpie provider test cf-jev` 或直接发一个 `/v1/systemone`。

## 回滚

```sh
magpie group set mb-classifier \
  models=cloudflare-jev/typesafe/jev,cloudflare-jev/@cf/cloudflare/clef,cloudflare-jev/@cf/cloudflare/clef-flash,typesafe/jev-latest \
  routing=order
magpie plugin rm cf-jev          # 或 magpie plugin off cf-jev
```

## 什么时候不再需要它

上游 `yetone/magpie` 把 `DecideAnswer` 改成「还剩一层 `result` 就继续拆」之后：

- magpie 自带的 `cloudflare-jev` 供应商会直接可用，这个插件就可以删掉；
- 补丁已经写好并验证过（`TestCloudflareAnswerPeelsTheEnvelopes` 在旧代码上红、新代码上绿），
  只是还没有 PR 权限能推上去。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.mjs` | 插件本体：`config` 声明决策供应商，`auth.loader` 返回自带 `fetch` 的实现，`peel()` 拆信封 |
| `smoke.mjs` | 不经 magpie、直接按 host 的方式调 `fetch` 的自检（token 从 magpie 的 `providers.json` 读，不落盘） |
| `peel.test.mjs` | `peel()` 的单元测试：两层信封、一层信封、错误体、已经扁平的答案 |

```sh
node --test peel.test.mjs     # 单元测试
node smoke.mjs                # 打真实 Cloudflare
```
