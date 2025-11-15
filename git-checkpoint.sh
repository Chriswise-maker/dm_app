#!/bin/bash

# Git Checkpoint Management Script
# Usage: 
#   ./git-checkpoint.sh save "description"  - Create a new checkpoint
#   ./git-checkpoint.sh list                - List all checkpoints
#   ./git-checkpoint.sh restore <commit>    - Restore to a specific checkpoint
#   ./git-checkpoint.sh show <commit>       - Show details of a checkpoint

CHECKPOINT_PREFIX="checkpoint:"

case "$1" in
    save)
        if [ -z "$2" ]; then
            echo "Error: Please provide a description for the checkpoint"
            echo "Usage: ./git-checkpoint.sh save \"description\""
            exit 1
        fi
        
        # Check if there are changes to commit
        if git diff-index --quiet HEAD --; then
            echo "No changes to checkpoint"
            exit 0
        fi
        
        git add -A
        git commit -m "$CHECKPOINT_PREFIX $2"
        echo "✓ Checkpoint created: $2"
        echo "  Commit: $(git rev-parse --short HEAD)"
        ;;
        
    list)
        echo "Available checkpoints:"
        echo "===================="
        git log --oneline --grep="^$CHECKPOINT_PREFIX" --all | nl -v 0
        ;;
        
    restore)
        if [ -z "$2" ]; then
            echo "Error: Please provide a commit hash to restore"
            echo "Usage: ./git-checkpoint.sh restore <commit-hash>"
            echo ""
            echo "Run './git-checkpoint.sh list' to see available checkpoints"
            exit 1
        fi
        
        # Warn about uncommitted changes
        if ! git diff-index --quiet HEAD --; then
            echo "Warning: You have uncommitted changes!"
            read -p "Do you want to create a checkpoint before restoring? (y/n) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                git add -A
                git commit -m "$CHECKPOINT_PREFIX Before restore to $2"
                echo "✓ Current state saved as checkpoint"
            fi
        fi
        
        echo "Restoring to checkpoint: $2"
        git checkout "$2"
        echo "✓ Restored to checkpoint"
        ;;
        
    show)
        if [ -z "$2" ]; then
            echo "Error: Please provide a commit hash"
            echo "Usage: ./git-checkpoint.sh show <commit-hash>"
            exit 1
        fi
        
        git show "$2" --stat
        ;;
        
    *)
        echo "Git Checkpoint Manager"
        echo "====================="
        echo ""
        echo "Commands:"
        echo "  save \"description\"  - Create a new checkpoint with description"
        echo "  list               - List all available checkpoints"
        echo "  restore <commit>   - Restore to a specific checkpoint"
        echo "  show <commit>      - Show details of a checkpoint"
        echo ""
        echo "Examples:"
        echo "  ./git-checkpoint.sh save \"Added user authentication\""
        echo "  ./git-checkpoint.sh list"
        echo "  ./git-checkpoint.sh restore abc123"
        ;;
esac

