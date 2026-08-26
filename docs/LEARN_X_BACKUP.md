# Learn-X 备份配置

## 范围

备份脚本完整扫描以下目录，不使用 Git 或 `.gitignore`：

```text
01_core/
03_input/
04_output/
```

仅排除 `.DS_Store` 和凭据类文件名（`.env`、密钥、证书、token、secret、password、cookie、session、wallet）。压缩包使用系统 `tar.gz`，不做客户端加密；压缩包内包含三个目录和 `manifest.json`，恢复时会校验文件数量、大小和 SHA-256。

## 飞书目标

脚本会按固定名称自动查找或创建：

1. 私有云盘文件夹，例如 `Learn-X Backups`；
2. 私有 Base，例如 `Learn-X Backup Index`；
3. Base 中名为 `Snapshots` 的表。

云盘文件夹不要公开分享，不要自动添加成员，不要放入公共空间。

首次执行备份时，脚本会自动创建私有云盘文件夹、Base 和 `Snapshots` 表；后续执行会复用它们。无需手动复制 token。

如需手动预置，也可以用 `lark-cli` 创建文件夹并从返回结果中取得 `folder_token`：

```bash
lark-cli drive +create-folder \
  --name "Learn-X Backups" \
  --as user \
  --format json
```

再把 `<folder-token>` 替换为真实值，创建 Base 和初始表结构：

```bash
lark-cli base +base-create \
  --name "Learn-X Backup Index" \
  --folder-token "<folder-token>" \
  --table-name "Snapshots" \
  --time-zone "Asia/Shanghai" \
  --fields '[
    {"name":"Snapshot ID","type":"text"},
    {"name":"Week","type":"text"},
    {"name":"Created At","type":"datetime"},
    {"name":"Archive Name","type":"text"},
    {"name":"Drive File Token","type":"text"},
    {"name":"Manifest SHA-256","type":"text"},
    {"name":"Archive SHA-256","type":"text"},
    {"name":"File Count","type":"number"},
    {"name":"Total Bytes","type":"number"},
    {"name":"Retention Class","type":"select","multiple":false,"options":[{"name":"recent"},{"name":"annual"},{"name":"recent+annual"}]},
    {"name":"Snapshot Year","type":"number"},
    {"name":"Status","type":"select","multiple":false,"options":[{"name":"success"},{"name":"failed"},{"name":"expired"},{"name":"delete_failed"}]},
    {"name":"Error","type":"text"},
    {"name":"Restored At","type":"datetime"}
  ]' \
  --as user \
  --format json
```

手动预置后可用真实 `base_token` 和 `table_id` 执行 `+field-list`，确认字段名称和类型。正常使用不需要把这些 token 写进项目。

Base 表字段如下：

```text
Snapshot ID       text
Week              text
Created At        datetime
Archive Name      text
Drive File Token  text
Manifest SHA-256  text
Archive SHA-256   text
File Count        number
Total Bytes       number
Retention Class   select: recent / annual / recent+annual
Snapshot Year     number
Status            select: success / failed / expired / delete_failed
Error             text
Restored At       datetime
```

创建 Base、云盘文件夹和旧快照删除都属于飞书写操作；执行前必须确认实际目标和权限。

## Token 覆盖（可选）

默认不需要配置 token：脚本会用当前用户身份自动查找或创建上面的固定名称资源，并且只在本次进程内使用 token。

如果已有同名资源或需要显式绑定指定资源，可以临时通过环境变量覆盖；不要把 token 写入仓库、配置文件或日志：

```bash
export LEARN_X_BACKUP_DRIVE_FOLDER_TOKEN='<private-drive-folder-token>'
export LEARN_X_BACKUP_BASE_TOKEN='<private-base-token>'
export LEARN_X_BACKUP_TABLE_ID='<snapshots-table-id>'
```

脚本使用当前用户身份执行飞书读写：`--as user`。

## 命令

备份指定周：

```bash
npm run backup:weekly -- --week 2026-W34
```

恢复到新目录：

```bash
npm run restore:weekly -- --week 2026-W34 --target /tmp/learn-x-restore-2026-W34
```

恢复不会覆盖非空目录。备份留存规则为：最近 31 天内所有成功快照，加上每个自然年度最后一次成功快照。

上传和 Base 读回成功后，快照状态保持 `success`；如果后续留存清理失败，命令返回非零状态并报告清理错误，但不会把已经成功上传的快照改成 `failed`。
