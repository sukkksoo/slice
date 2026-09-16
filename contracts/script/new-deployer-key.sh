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
cast wallet new "$DIR" "$NAME"

cat <<EOF

Keystore: $DIR/$NAME

Next:

  1. Fund the address printed above with USDC on Arc mainnet. Arc pays gas in USDC.
     Budget ~25 USDC for the factory plus a first vault, and more for seed liquidity.

  2. Confirm it arrived:

     cast balance <address> --rpc-url https://rpc.mainnet.arc.io

  3. Deploy. The key is referenced by name and never appears on the command line:

     export ARC_RPC_URL=https://rpc.mainnet.arc.io
     export DELTA_OWNER=0x76f7D9AaBC2E280e3cD9ffFf6dd34a5cba9A5030
     export DELTA_TREASURY=0x76f7D9AaBC2E280e3cD9ffFf6dd34a5cba9A5030

     forge script script/Deploy.s.sol --rpc-url \$ARC_RPC_URL           # dry run
     forge script script/Deploy.s.sol --rpc-url \$ARC_RPC_URL \
       --broadcast --account $NAME

This key only pays gas. Ownership and both fee streams go to DELTA_OWNER / DELTA_TREASURY,
so a compromise of this key does not hand over the protocol. See MAINNET.md for the rest.
EOF
