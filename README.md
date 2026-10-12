# GateKeeper

Event tickets that are hard to scalp, built for Android with Solana Mobile Wallet Adapter. Submission for the Radiants CLOCK IN hackathon.

GateKeeper does not ban ticket transfers. It makes reselling for profit cost money, and it makes a screenshot of a ticket worthless at the door.

## The problem

Scalpers buy tickets in bulk and resell them at a markup. Fans who want to go pay two or three times face value, and organizers see none of it. The usual defenses are weak in different ways. Banning transfers also blocks the friend who can't make it. Photo ID checks slow the line down. Paper and PDF tickets can be photographed and sold to several buyers, and only the first one through the door gets in.

A plain NFT ticket fixes the copying problem but adds another: it moves freely between wallets on any marketplace, and the organizer can't stop it.

## What GateKeeper does

A ticket is a compressed NFT (Metaplex Bubblegum) minted into the buyer's wallet. Four rules sit on top of it.

**The QR code is live.** The wallet signs one session delegation. The app then keeps re-signing the QR with that session key, and a code is valid for 60 seconds. A screenshot is stale by the time anyone tries to use it, and each code can be scanned only once.

**Transfers go through the app and cost a bond.** To transfer a ticket, the seller locks 250 SKR in the GateKeeper program. The bond is refunded after the event. If the organizer flags the transfer as a paid resale, the bond is slashed. Honest transfers cost the seller nothing in the end. Scalping costs them the bond on every ticket.

**Transfers made outside the app are rejected at the gate.** The backend keeps a registry of who holds each ticket. A ticket that moved wallet-to-wallet without a bond on-chain scans as "Unregistered transfer" and doesn't get in.

**Each wallet can hold one ticket per event, and a used ticket stays used.** The scan marks the ticket as checked in. It can't be scanned again, transferred, or upgraded.

Organizers have their own side of the app: mint tickets for an event, scan at the door, and flag resales. To get that access an organizer has to lock SKR.

## When an organizer flags a resale

The program can't see what a buyer pays, so slashing a bond is the organizer's decision. A flag has to come before the organizer resolves the bonds after the event, because resolving refunds them.

Flag a transfer when there is evidence of a paid resale above the event's policy: an asking price above face value, a public listing, a chat screenshot, or a buyer at the door saying they paid a markup. Don't flag gifts, swaps between friends, or sales at or below face value. A slash can't be undone, so suspicion alone isn't enough.

Organizers should state the policy up front, for example "selling at face value or less is fine." The bond deters scalping by making it expensive. It doesn't prove a sale took place.

## How SKR is used

SKR does three jobs in the program. None of them is decorative: each one is a lock or a spend that changes what a user can do.

| Use | Amount | What happens |
|---|---|---|
| Transfer bond | 250 SKR | Locked by the seller at transfer. Refunded after the event, or slashed if the organizer flags a resale. |
| VIP upgrade | 500 SKR | Burned to upgrade a ticket to VIP. |
| Organizer stake | 1,000 SKR on devnet | Locked to unlock minting and scanning. Can be unstaked, and the program has a slash instruction. The amount is adjustable by the authority (`set_stake_amount`), and the mainnet target is about $10 worth. |

The program reads the token mint from its config account, so nothing in the contract is hard-coded to a particular token.

**Devnet.** SKR does not exist on devnet. The repo includes a mock token, tSKR, with a faucet in the app, and the program is initialized with that mint. Moving to mainnet means initializing with the real SKR mint and setting the stake amount. No contract changes are needed. Because tSKR is free, the devnet demo shows the mechanism but not the economic pressure. That pressure only exists once the token has value.

## Architecture

```
contract/   Anchor program (gatekeeper_bonds)
backend/    Express server: mint, verify, bonds, organizer auth
gatekeeper-app/   Expo Android app with Mobile Wallet Adapter
```

**Contract.** Program ID `G65C3XsAhvJkYiE4GEcY5jJuabsWVDL2dXJ1D8wbY3ST` on devnet. Instructions: `initialize`, `lock_transfer_bond`, `resolve_bond`, `burn_for_vip`, `init_stake_config`, `set_stake_amount`, `stake_organizer`, `unstake_organizer`, `slash_organizer`. Accounts are PDAs seeded `config`, `vault`, `bond`, `vip`, `stake_cfg`, `stake_vault` and `organizer`.

**Backend.** The backend pays transaction fees. It creates one Merkle tree per event, sized to the event's capacity. It reads wallet contents through the Helius DAS API. Organizers log in by signing a message with their wallet. The server then issues a short-lived signed token and checks on every organizer request that the wallet still has SKR staked.

**App.** Expo with a development build, because Mobile Wallet Adapter doesn't run in Expo Go. Attendees see their tickets, show the live pass, and transfer or upgrade. Organizers mint, scan and flag.

## Running it

You need a recent Node release, an Android phone with a Solana wallet app set to devnet, and a Helius API key.

Backend:

```
cd backend
npm install
cp .env.example .env     # fill in the values
npx tsx scripts/setup.ts # funds and prepares the backend wallet
npm run dev
```

The backend wallet needs devnet SOL, because it pays fees.

App:

```
cd gatekeeper-app
npm install
eas build --profile development --platform android
npx expo start --dev-client
```

Set the backend URL in the app config. On a local network that is your computer's LAN IP and port 8787.

Contract: build and deploy `contract/programs/gatekeeper_bonds` with Anchor, or paste it into Solana Playground. Then call `initialize` with your token mint and `init_stake_config` with the stake amount.

## What it doesn't do

The bond is a deterrent, and it has gaps.

- The program can't see what a buyer pays. A resale is only penalized if the organizer flags it.
- If a seller moves a ticket in the app and takes cash off-chain, nothing detects that.
- Someone who hands over a whole wallet or its seed phrase can't be told apart from the original holder.
- The one-ticket-per-wallet limit is beaten by creating more wallets. Stopping that needs identity or proof of personhood, which this project doesn't attempt.
- Devnet SKR is free, so the bond has no real cost until the project runs on mainnet.

The goal is to make scalping unprofitable at scale for the person doing it, while leaving normal transfers between friends cheap and unchanged.

## Download and install

Android APK: https://github.com/Emmanuel-webDev/Gate_Keepers/releases/download/v1.0.0/gatekeeper.apk

Open the link on an Android phone, download the file and tap it to install. Android may ask you to allow installs from this source, because the app isn't on the Play Store. If Play Protect warns, choose "Install anyway".

You also need a Solana wallet app installed and set to devnet. The app talks to it through Mobile Wallet Adapter. The backend pays transaction fees, and the app has a faucet for the mock SKR token.

On an emulator, drag `gatekeeper.apk` onto the emulator window.

Source: https://github.com/Emmanuel-webDev/Gate_Keepers