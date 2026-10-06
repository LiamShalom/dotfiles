# The following lines were added by Docker Desktop to add commands to your PATH.
export PATH="$PATH:/Users/liamshalom/.docker/bin"
# End of Docker Desktop section.

eval "$(/opt/homebrew/bin/brew shellenv)"

# theclawbay-shell-managed:start
[ -f "$HOME/.config/theclawbay/env" ] && . "$HOME/.config/theclawbay/env"
# theclawbay-shell-managed:end
