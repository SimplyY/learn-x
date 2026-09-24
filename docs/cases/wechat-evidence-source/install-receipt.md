# 安装凭证｜TraceMemo 2.4.0（里程碑 2，2026-09-24）

## 下载与校验

| 项 | 值 |
|---|---|
| 来源 | `https://github.com/Wxw-Gu/TraceMemo/releases/download/v2.4.0/tracememo-2.4.0-arm64.dmg`（官方 v2.4.0 发布，2026-09-15 发布，非 prerelease） |
| 架构 | arm64（本机 `uname -m` = arm64，macOS 26.5.2） |
| 大小 | 183,942,379 字符 ≈ 175 MiB（与 release 元数据一致） |
| sha512 | `ebbd71bc93ce9b97625df7184d99d52d1bbee0c5ab04670694b5908e1c5c6d8129ad8b97ddecb135bf66eb31fde97c4f3ad3c6218a67b47037b6e20b320935a9` |
| dmg 完整性 | `hdiutil` CRC32 `$F19E412D` 校验通过；UDIF zlib 格式，APFS 卷挂载成功 |
| 安装位置 | `/Applications/TraceMemo.app`（`ditto` 复制，10:57 本地时间） |
| SIP | 全程保持 enabled，未做任何系统保护调整 |

## 供应链发现（如实记录）

- **该 arm64 官方构建没有有效代码签名**：`Contents/_CodeSignature` 缺失，`codesign --verify` 失败（`Identifier=Electron`，`TeamIdentifier=not set`），无 Apple 公证。属上游打包问题，非传输损坏（下载链路为官方 HTTPS＋CRC32 校验通过）。
- `latest-mac.yml` 只登记 x64 资产 sha512，arm64 无官方哈希可用。
- 上游仓库（499 stars，活跃维护）仅 `test.yml` CI，release 为维护者手动上传，无 CI 构建溯源。
- 结论：信任锚是「官方发布源本身」（冻结需求指定），传输完整性已核验；未签名风险由用户在首次启动与授权系统权限时知情把控。

## 本机环境

- 微信 4.1.13（`/Applications/WeChat.app`，运行中，数据目录 `~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files`）——在 TraceMemo 2.4.0 适配范围（4.1.13.x）内。
- TraceMemo 启动成功（pid 89273，Gatekeeper 未拦截）。

## 待完成（需用户在 GUI 操作）

1. 按 TraceMemo「第一次使用」页面连接：确认微信数据目录指向当前账号；Apple Silicon 自动 Key 获取流程。
2. 用户在界面核对数据库目录与账号。
3. **保持 Agent Hub 关闭**；不启用微信发送或机器人操作（不变量）。
4. 之后做约 30 条已知消息交叉核验（30/30 可定位才算里程碑 2 通过）。
