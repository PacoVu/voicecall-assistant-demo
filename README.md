# RingCentral voice call assistant demo

## Create a RingCentral app
Login your RingCentral developer account at https://developers.ringcentral.com and create an app with the following requirements:
- App type: "Server/No UI"
- Authorization: "JWT auth flow"
- Security app scopes: "Call Control" - "Read Accounts"

## Clone the project and setup

```
git clone https://github.com/PacoVu/voicecall-assistant-demo
cd voicecall-assistant-demo
cp dotenv .env
```

Open the `.env` file and set the values.

- `RINGCENTRAL_CLIENT_ID`=Your_App_Client_Id
- `RINGCENTRAL_CLIENT_SECRET`=Your_App_Client_Secret

- `RINGCENTRAL_JWT`=The-Virtual-Voice-Assistant-JWT

- `WATSON_SPEECH2TEXT_API_KEY`=Your_Watson_Speech_To_Text_Api_Key
- `STT_INSTANCE_ID`=Your_SpeechToText_Instance_Id

- `GPT_SERVER_URL`=api.openai.com
- `GPT_API_KEY`=Your-OpenAI-Appkey

## Provide some customer demo data

To test a customer call, you should create a customer info object in the "customers.json" file.

Remember that the phone number must not include the plus sign and the country code!

```
{
  "name": "your customer name",
  "phoneNumber": "customer phone number",
  "ssn": "1234",
  "zipCode": "12345",
  "dob": "05/17/1970",
  "billings": {
    "last": {
      "dueDate": "June 01, 2024",
      "paidDate": "May 30, 2024",
      "amount": "$249.00"
    },
    "next": {
      "dueDate": "July 01, 2024",
      "paidDate": "",
      "amount": "$249.00"
    }
  },
  "callbackRequest": true,
  "status": "Diamond",
  "lastNote": ""
}
```

## Provide some agent demo data

To test call transfer to an agent, you should create an agent info object in the "agents.json" file.

Check your RingCentral account and pick a few agents who will receive the transferred calls. Name the agent accordingly and provide the exact 'extensionNumber'.
Remember to use the specified "extensionNumber" in the code where you look for the assigned agent based on the caller request.

```
{
  "name": "technical support",
  "status": "Available",
  "extensionNumber": "103",
  "phoneNumber": "",
  "extensionId": "",
  "waitList": []
}
```

## Run the demo
Open a terminal window and run the following command.

Install the required dependencies and run the app
```
$ npm install --save
$ node index.js
```

## Test

Make a phone call to the virtual voice assistant's phone number.

Listen to the assistant and ask generic questions e.g "What is the population of San Francisco?". To request for a call transfer, you can say e.g. "Can I speak to someone in the technical support team?".
