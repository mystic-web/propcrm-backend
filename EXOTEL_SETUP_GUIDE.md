# Exotel Setup Guide — PropCRM Call Recording

## Step 1: Exotel Account Banao
1. https://exotel.com pe jao → Sign Up (free trial available)
2. India ka account banao
3. Dashboard mein yeh 4 cheezein milegi:
   - **Account SID** (EXOTEL_SID)
   - **API Key** (EXOTEL_API_KEY)  
   - **API Token** (EXOTEL_API_TOKEN)
   - **ExoPhone** (virtual number — EXOTEL_CALLER_ID)

## Step 2: .env File Fill Karo
```env
EXOTEL_SID=EXxxxxxxxxxxxxxxx
EXOTEL_API_KEY=xxxxxxxxxxxxxxxx
EXOTEL_API_TOKEN=xxxxxxxxxxxxxxxx
EXOTEL_CALLER_ID=+918XXXXXXXXX
BACKEND_URL=https://your-ngrok-url.ngrok.io
```

## Step 3: Exotel App Setup
1. Exotel Dashboard → Apps → Create New App
2. App Type: **Passthru** (direct connect)
3. Recording: **Enable** ✅
4. Save App

## Step 4: ExoPhone se App Connect Karo
1. Dashboard → Numbers → Manage Numbers
2. Apna ExoPhone select karo
3. Incoming/Outgoing App → apna new app set karo

## Step 5: Webhook URL Set Karo
Exotel Dashboard → Apps → Applet Settings:
```
Status Callback URL: https://your-ngrok-url.ngrok.io/webhook/exotel/status
Method: POST
```

## Step 6: Test Karo
```bash
# Backend start karo
npm run dev

# ngrok se public URL lo
ngrok http 5000

# CRM mein kisi lead ke detail mein jao
# "📞 Click-to-Call" button dabao
# Executive mobile number daalo
# "Start Call" dabao
# Pehle executive ka phone bajega, phir client se connect hoga
# Call khatam hone pe recording automatic CRM mein aa jaayegi
```

## Flow Summary
```
CRM → POST /api/calls/initiate
    → Exotel API call
    → Exec ka phone bajta hai (recording aware nahi)
    → Client se connect
    → Dono sides record
    → Call end → Exotel → POST /webhook/exotel/status
    → Recording URL CRM mein save
    → Admin dashboard pe dikh jaata hai
```

## Pricing
- Setup: Free (trial mein INR 500 credit)
- Per minute: ~₹1.5-3 (India numbers)
- Recording storage: Free (30 days)

## Bina Exotel ke Test
CRM mein "🧪 Test Call" button click karo — fake call log aayega
(jab backend running ho)
