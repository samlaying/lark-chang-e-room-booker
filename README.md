# Lark Chang'e Room Booker

每天自动预约三天后的 `诚盈9号楼-4F-嫦娥`，时间段是 16:00-18:00。

## What It Does

- 按 `Asia/Shanghai` 计算“三天后”的日期。
- 查找 `F4`、`嫦娥` 在目标时间段是否空闲。
- 使用 `calendar +create` 创建日程，并把返回的会议室 `omm_...` ID 和固定参会人一起加入。
- 非 dry-run 时会先查同时间段是否已有同标题预约，避免重复创建。

## Local Test

```bash
lark-cli --profile "猎聘" auth status --verify
npm run check
DRY_RUN=true node scripts/book-chang-e-room.mjs
```

指定日期测试：

```bash
DRY_RUN=true node scripts/book-chang-e-room.mjs --date 2026-05-24
```

真正创建：

```bash
node scripts/book-chang-e-room.mjs
```

## GitHub Actions

Workflow: `.github/workflows/book-chang-e-room.yml`

Schedule:

```yaml
cron: "30 16 * * *"
timezone: "Asia/Shanghai"
```

## Required Lark Scopes

用户身份需要至少包含：

- `calendar:calendar.event:create`
- `calendar:calendar.event:update`
- `calendar:calendar.event:read`
- `calendar:calendar.free_busy:read`

## Credentials

推荐两种方式：

### Option A: Self-hosted Runner

在 self-hosted runner 机器上执行一次：

```bash
npm install -g @larksuite/cli@1.0.35
lark-cli config init --name "猎聘"
lark-cli --profile "猎聘" auth login --scope "calendar:calendar.event:create calendar:calendar.event:update calendar:calendar.event:read calendar:calendar.free_busy:read"
lark-cli --profile "猎聘" auth status --verify
```

然后把 workflow 的 `runs-on` 改成你的 self-hosted label。

### Option B: GitHub-hosted Runner

把可用的 lark-cli 配置注入为 secret：

- `LARK_CLI_HOME_B64`
- `LARK_CLI_SUPPORT_B64`
- `LARK_CLI_MASTER_KEY`

`LARK_CLI_HOME_B64` 是 `$HOME/.lark-cli` 的压缩包。生成命令：

```bash
tar -C "$HOME" -czf - .lark-cli | base64 | tr -d '\n'
```

把输出写入 GitHub repository secret `LARK_CLI_HOME_B64`。

注意：如果你的本机 lark-cli 把用户 token 存在系统 keychain，而不是 `$HOME/.lark-cli`，这个 secret 可能不包含用户授权。遇到这种情况，用 self-hosted runner 更稳。

## Configuration

可用 GitHub Actions variables 或环境变量覆盖：

| Name | Default |
| --- | --- |
| `LARK_PROFILE` | `猎聘` |
| `TIMEZONE` | `Asia/Shanghai` |
| `DAYS_AHEAD` | `3` |
| `ROOM_NAME` | `嫦娥` |
| `ROOM_FLOOR` | `F4` |
| `START_TIME` | `16:00` |
| `END_TIME` | `18:00` |
| `SUMMARY` | `Bagent日会` |
| `ATTENDEE_IDS` | `ou_6dd9ee4404478ed4a4d3e6a474bc9613` |

Manual workflow dispatch 默认是 dry-run。确认结果后，把 `dry_run` 取消勾选即可真正创建。

## Deploy To Your Server (Ubuntu 22.04)

This repo includes `systemd` deployment files so you can run without GitHub `schedule`.

### 1) Connect to server

```bash
ssh root@47.99.87.139
```

### 2) Clone and install

```bash
git clone https://github.com/samlaying/lark-chang-e-room-booker.git
cd lark-chang-e-room-booker
sudo bash deploy/install-on-ubuntu.sh
```

### 3) Authorize lark-cli once on server

```bash
lark-cli config init --name "猎聘"
lark-cli --profile "猎聘" auth login --scope "calendar:calendar.event:create calendar:calendar.event:update calendar:calendar.event:read calendar:calendar.free_busy:read"
lark-cli --profile "猎聘" auth status --verify
```

### 4) Review env and run a test booking

```bash
sudo vi /etc/lark-chang-e-room-booker.env
sudo systemctl start lark-room-booker.service
sudo journalctl -u lark-room-booker.service -n 100 --no-pager
```

### 5) Check timer status

```bash
systemctl list-timers lark-room-booker.timer
```
