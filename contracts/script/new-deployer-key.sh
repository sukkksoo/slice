#!/usr/bin/env bash
# Create the Arc mainnet deploying key, as an encrypted Foundry keystore.
#
# WHY YOU RUN THIS AND NOT THE ASSISTANT
#
# A key generated inside an assistant session is printed into the session transcript, which is
# written to disk in plaintext under ~/.claude/projects/. It would be readable by anything that
# reads those logs, forever, before it ever held a cent. Generating it here means the key exists
# only in this terminal and in the encrypted keystore file.
#
# The password is prompted for and hidden. Do not pass --unsafe-password.
#
#   ./script/new-deployer-key.sh
set -euo pipefail

NAME="${1:-slice-deployer}"
DIR="$HOME/.foundry/keystores"

command -v cast >/dev/null || { echo "cast not found — install Foundry first"; exit 1; }
mkdir -p "$DIR"

if [ -e "$DIR/$NAME" ]; then
  echo "A key named '$NAME' already exists at $DIR/$NAME"
  echo "Refusing to overwrite it. Pass a different name: ./script/new-deployer-key.sh my-other-key"
  exit 1
fi

echo "Creating '$NAME'. Choose a strong password — losing it loses the key."
echo
# tee so the password prompt and the address stay visible, while the address is also captured
# for the instructions below — otherwise they would print an empty command to copy.
cast wallet new "$DIR" "$NAME" | tee /tmp/slice-newkey.$$
ADDRESS=$(grep -oE "0x[0-9a-fA-F]{40}" /tmp/slice-newkey.$$ | head -1)
rm -f /tmp/slice-newkey.$$

cat <<EOF

Keystore: $DIR/$NAME

This key only signs. It receives no ownership and no fees — those belong to DELTA_OWNER and
DELTA_TREASURY, set when the factory was deployed. Losing or leaking it costs the gas inside it.

Fund the address above with USDC on Arc mainnet; gas is charged in USDC there. How much depends
on what this key is for:

  Deploying      ~15 USDC covers the factory, a first vault and a round trip through it.
                 See MAINNET.md.

  Keeping the    A poke costs about 0.3 cents, but it repeats forever, so the interval sets the
  oracle warm    bill: ~26 USDC/month at 5-minute pokes, ~85 at 90-second pokes. Deposits and
                 harvests poke for free, so a busy vault needs far less. See script/keeper.sh
                 for how the interval trades off against the TWAP window.

Check it arrived:

  cast balance $ADDRESS --rpc-url https://rpc.mainnet.arc.io

Then reference the key by name — it never appears on a command line or in shell history:

  forge script script/Deploy.s.sol --rpc-url \$ARC_RPC_URL --broadcast --account $NAME
  PRIVATE_KEY=... ./script/keeper.sh          # keeper reads a raw key, not a keystore

EOF
