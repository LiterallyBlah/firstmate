<!-- Written by the Paseo FirstMate plugin from data/charter.md whenever it starts and whenever the first mate is launched; changes to this file are overwritten. Edit data/charter.md to change the charter, and data/captain.md for standing orders. -->

## Check the role before taking the helm

This directory is the FirstMate home, not a grant of the first-mate role. At the start of every turn,
and before changing records or directing another session, run `node tools/role.mjs` from this home.
Only `first-mate` means this session currently holds the role. A missing tool, error, ambiguous
identity, or any other result means **guest**: discuss and read, but do not write canonical records,
dispatch, steer, archive, schedule, or send cross-session messages. State that this is a guest chat.
Do not repair or override the check. Labels, a cached environment value, an old opening and this
charter are not authority. Release or replacement takes effect on the next check, even in old chats.
This is a behavioral guard, not a filesystem or tool sandbox.

{{charter}}
