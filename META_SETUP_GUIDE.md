# Meta Lead Ads → PropCRM Setup Guide

## Step 1: Backend Server Chalaao

```bash
cd propcrm-backend
npm install
cp .env.example .env
npm run dev
```

Server start hoga: http://localhost:5000

---

## Step 2: .env File Fill Karo

```env
META_VERIFY_TOKEN=propcrm_secret_123     # Koi bhi secret string
META_APP_SECRET=xxxxxxxxxxxx             # Meta App Dashboard se
META_PAGE_ACCESS_TOKEN=xxxxxxxxxxxx      # Facebook Page Token
PORT=5000
FRONTEND_URL=http://localhost:3000
```

---

## Step 3: Webhook Public URL Banao (ngrok)

Meta ko public URL chahiye. Development ke liye ngrok use karo:

```bash
# Install ngrok: https://ngrok.com
ngrok http 5000
```

Tumhara public URL milega:
```
https://abc123.ngrok.io
```

Webhook URL hoga:
```
https://abc123.ngrok.io/webhook/meta
```

---

## Step 4: Facebook Developer App Setup

1. https://developers.facebook.com pe jao
2. **My Apps → Create App → Business** select karo
3. App Dashboard mein **Webhooks** add karo
4. **Subscribe to page webhooks**:
   - Callback URL: `https://abc123.ngrok.io/webhook/meta`
   - Verify Token: `propcrm_secret_123` (jo .env mein rakha)
5. **leadgen** field pe subscribe karo

---

## Step 5: Page Access Token Lo

1. Facebook Developer Dashboard → Tools → Graph API Explorer
2. Page select karo
3. **Generate Access Token**
4. Permissions: `leads_retrieval`, `pages_show_list`, `pages_read_engagement`
5. Token ko .env mein `META_PAGE_ACCESS_TOKEN` mein daalo

---

## Step 6: Lead Ad Form Link Karo

1. Meta Business Manager → Lead Ads
2. Form create karo (Name, Mobile, Email fields zaroori hain)
3. Page ko developer app se connect karo

---

## Testing (Bina Meta Setup Ke)

Backend running ho toh CRM mein **🧪 Test Meta Lead** button dikhega.
Click karo — fake Meta lead automatically aayega!

---

## API Endpoints

| Method | URL | Description |
|--------|-----|-------------|
| GET | /api/leads | Sab leads |
| POST | /api/leads | Lead add karo |
| PUT | /api/leads/:id | Lead update |
| DELETE | /api/leads/:id | Lead delete |
| GET | /api/stats | Stats |
| POST | /api/test/meta-lead | Test Meta lead |
| GET | /webhook/meta | Webhook verify |
| POST | /webhook/meta | Meta lead receive |

---

## Production Deployment

- Backend: **Railway / Render / Heroku** pe deploy karo (free tier available)
- Railway: `railway up` command se seedha deploy
- Phir ngrok ki jagah production URL use karo Meta webhook mein

