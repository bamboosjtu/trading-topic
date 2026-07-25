# 仓库 Skills

`.agents/skills/` 是本仓库 Skill 的唯一源目录，也是唯一受版本控制的 Skill 目录。

`.claude/skills/` 不是第二份源文件，而是指向 `.agents/skills/` 的本地 Junction。这样 Claude Code 和 Codex 读取的是同一批文件，不会因复制或全局替换产生内容漂移。

在仓库根目录重新生成兼容入口：

```powershell
powershell -ExecutionPolicy Bypass -File .agents/sync-claude-skills.ps1
```

只检查、不修改：

```powershell
powershell -ExecutionPolicy Bypass -File .agents/sync-claude-skills.ps1 -Check
```

脚本只会替换 Junction；如果 `.claude/skills/` 是普通目录，脚本会拒绝覆盖，防止误删手工文件。
