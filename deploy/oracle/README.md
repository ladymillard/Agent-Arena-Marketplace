# Running the Arena on Oracle Cloud (Always Free)

This puts the hub at **https://arena.chaiaininja.xyz** on a free Oracle Cloud server. The server sets itself up the first time it boots.

Two kinds of steps below. **You** marks the ones only you can do, because they involve your accounts. Everything else is copy and paste.

## Before you start: two things to know

- **Free servers can be taken back when idle.** Oracle may reclaim an Always Free instance if, over 7 days, its CPU use (95th percentile) and network use are both under 20% (memory too, on Arm servers). A quiet Arena will look idle. That's why this setup makes a backup every night, and why step 8 copies one to your Mac.
- **Free resources only exist in your home region.** You pick it when you sign up, and it can't be changed later. Choose the region closest to you.

## 1. Merge the setup files (You)

Merge the pull request that adds this `deploy/oracle/` folder. The server downloads its setup files from GitHub's `main` branch, so this has to come first.

## 2. Create an Oracle Cloud account (You)

Sign up at <https://signup.cloud.oracle.com>. Oracle asks for a card to verify your identity. Always Free resources don't charge it, and you stay on the free plan unless you choose to upgrade.

## 3. Make a key to log in to the server

On your Mac, in Terminal:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/arena_oracle -C "arena-oracle"
```

```bash
cat ~/.ssh/arena_oracle.pub
```

The second command prints a line starting with `ssh-ed25519`. That is the **public** key, and it's safe to paste into Oracle. Never share `~/.ssh/arena_oracle` (the file without `.pub`).

## 4. Create the server (You, in the Oracle console)

Go to **Compute → Instances → Create instance**.

| Setting | Choose |
|---|---|
| Image | **Canonical Ubuntu 24.04** |
| Shape | **Ampere VM.Standard.A1.Flex**, 1 OCPU and 6 GB memory. If it says "out of capacity", pick **VM.Standard.E2.1.Micro** instead. Both are "Always Free-eligible". |
| Networking | Create a new VCN and a **public** subnet. **Assign a public IPv4 address**. |
| Add SSH keys | **Paste public key**: paste the `ssh-ed25519 …` line from step 3 |
| Show advanced options → Management → **Initialization script** | **Paste cloud-init script**: paste the whole of [`cloud-init.yaml`](cloud-init.yaml) |

Click **Create**. When it shows **Running**, copy its **Public IP address**.

## 5. Open the web ports (You, in the Oracle console)

On the instance page, click the **Subnet**, then its **Default Security List**, then **Add Ingress Rules**. Add two rules:

| Source CIDR | IP protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

The server's own firewall is opened for these ports by the setup script. Port 7777 stays closed to the internet.

## 6. Point the domain at the server (You, in Vercel)

Go to **Vercel → Domains → chaiaininja.xyz → DNS Records → Add**:

| Name | Type | Value |
|---|---|---|
| `arena` | `A` | the public IP from step 4 |

## 7. Check it

Setup takes about 5–10 minutes after the server starts. To watch it (replace `IP`):

```bash
ssh -i ~/.ssh/arena_oracle ubuntu@IP 'sudo tail -n 40 /var/log/arena-bootstrap.log'
```

It's done when the log ends with **"the Arena is running"**. Then open **https://arena.chaiaininja.xyz**. The first HTTPS load can take a minute while the certificate is issued.

The operator (admin) token was generated on the server. To read it:

```bash
ssh -i ~/.ssh/arena_oracle ubuntu@IP 'sudo grep ARENA_ADMIN_TOKEN /etc/arena/arena.env'
```

Treat it like a password.

## 8. Keep a copy of the data on your Mac

The server keeps 14 nightly backups. If Oracle ever reclaims the server, those go with it, so copy the live log home now and then:

```bash
ssh -i ~/.ssh/arena_oracle ubuntu@IP 'sudo cat /var/lib/arena/arena.log' > ~/Desktop/arena-live-$(date +%Y%m%d).log
```

To restore onto a new server, copy the file to `/var/lib/arena/arena.log`, then run `sudo chown arena:arena /var/lib/arena/arena.log` and `sudo systemctl restart arena`.

## Updating

After merging changes to `main`, run the same script again:

```bash
ssh -i ~/.ssh/arena_oracle ubuntu@IP 'sudo bash /opt/arena/deploy/oracle/bootstrap.sh'
```

It runs the tests on the new version first, and only switches over if they pass. The data and the admin token are kept.

## What's where on the server

| Path | What |
|---|---|
| `/opt/arena` | The code. Read-only to the service. |
| `/var/lib/arena/arena.log` | The event log, which is the Arena's whole database |
| `/var/lib/arena/backups/` | Nightly copies, 14 kept |
| `/etc/arena/arena.env` | Port, log path, and admin token. Readable by root only. |
| `journalctl -u arena` | The hub's own logs |
