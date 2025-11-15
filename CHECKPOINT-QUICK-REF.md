# Checkpoint Quick Reference

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `./git-checkpoint.sh save "msg"` | Create new checkpoint | `./git-checkpoint.sh save "Added login"` |
| `./git-checkpoint.sh list` | List all checkpoints | `./git-checkpoint.sh list` |
| `./git-checkpoint.sh restore <hash>` | Restore checkpoint | `./git-checkpoint.sh restore abc123` |
| `./git-checkpoint.sh show <hash>` | View checkpoint details | `./git-checkpoint.sh show abc123` |

## Current Checkpoints

Run `./git-checkpoint.sh list` to see all available checkpoints.

## Tips

- 💾 Save often, especially before big changes
- 📝 Use descriptive names
- 🔍 Review with `list` before restoring
- ⚠️ System warns before overwriting changes

## AI Commands

You can ask me to:
- "Create a checkpoint for [description]"
- "Show all checkpoints"
- "Restore to checkpoint [number/hash]"
- "What's in checkpoint [hash]?"

