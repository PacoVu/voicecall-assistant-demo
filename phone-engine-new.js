//require('dotenv').load();
const server = require('./index')
const fs = require('fs')
const RtpPacket = require('werift-rtp')
const Softphone = require('ringcentral-softphone').default
const WatsonEngine = require('./watson.js');
const AssistantEngine = require('./assistant.js');
const RingCentral = require('@ringcentral/sdk').SDK

var MAXBUFFERSIZE = 160 * 100

const rcsdk = new RingCentral({
  server: process.env.RINGCENTRAL_SERVER_URL,
  clientId: process.env.RINGCENTRAL_CLIENT_ID,
  clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET
})
var platform = rcsdk.platform();

platform.on(platform.events.loginSuccess, async function(e){
  console.log("Login success")
});

let callTransferRequests = ["call transfer", "phone call transfer", "phone transfer", "transfer call", "customer service"]
let callForwardRequests = ["speaking to", "speaking with", "speaking to someone", "speaking with someone", "talk to someone", "talk with agent"]
let supportedChatTopics = ["voice communications", "communications", "meeting"]

class ConversationStates {
  constructor() {  // Constructor
    this.mainState = 'chatting'
    this.subState = 'no-action'
    this.previousMainState = ""
    /*
    this.PASSED_MAIN_STATES = [
      "chatting", // => customer talks to the assistant
      "wait-on-the-line", // => customer decicides to wait on the line. Customer still can talk to the assistant
      "call-transfer-request",
      "wait-for-transfer-request",
    ]

    this.PASSED_SUB_STATES = [
      "no-action", // Normal conversation between the assistant and a customer
      "ask-for-transfer", // => customer asked for call transfer =>
      "wait-for-decision", // => bot is waiting for customer's decision
      "wait-for-clarification", // => bot is waiting for customer to clarify his question
    ]
    */
  }

  setMainState(newState){
    this.previousMainState = this.mainState
    this.mainState = newState
    console.log(this.mainState)
    console.log(this.previousMainState)
  }

  setSubState(newState){
    this.subState = newState
  }

  getMainState(){
    return this.mainState
  }
  getSubState(){
    return this.subState
  }

  getPreviousMainState(){
    return this.previousMainState
  }
}

//myState = new States();

/*
let rules = {
    robocall_defend: {
      name: "robocall_defend",
      active: false,
      condition: "unknown-number",
      screening_mode: ["passcode"],
      deny_action: "hangup",
      accept_action: "hangup"
    },
    telemarketer_defend: {
      name: "telemarketer_defend",
      active: false,
      condition: "unknown-number",
      screening_mode: ["products"],
      deny_action: "hangup",
      accept_action: "transfer"
    },
    customer_fraud_defend: {
      name: "customer_fraud_defend",
      active: true,
      condition: "unknown-number",
      index: 0,
      screening_mode: ["ssn","dob","phone-number"],
      deny_action: "transfer",
      accept_action: "connect"
    },
    customer_verification: {
      name: "customer_verification",
      active: false,
      condition: "known-number",
      index: 0,
      screening_mode: ["ssn","dob"],
      deny_action: "transfer",
      accept_action: "connect"
    }
}
*/
/*
var manager =
  {
    name : "Phong Vu",
    phoneNumber : "2092520012",
    status: "available"
  }
*/

let customersList = [
  {
    name : "Rito Salomone",
    phoneNumber : "2898054575",
    ssn: "1369",
    zipCode: "95123",
    dob: "05/17/1970"
  },
  {
    name : "Phong Vu",
    phoneNumber : "6502245475",
    ssn: "1234",
    zipCode: "95123",
    dob: "05/17/1970"
  },
  {
    name : "Paco Vu",
    phoneNumber : "6505130930",
    ssn: "6789",
    zipCode: "94084",
    dob: "01/02/2001"
  },
  {
    name : "Tyler Liu",
    phoneNumber : "6504306662",
    ssn: "3456",
    zipCode: "94084",
    dob: "01/02/2001",
    status: "Silver"
  }
]

let fraudNumbers = [
    "234567890",
    "12092845360",
    "6505130931"
]

let agentsList = [
    {
      name: "marketting",
      extensionNumber: "11680",
      phoneNumber: "",
      status: "available"
    },
    {
      name: "George Logan",
      extensionNumber: "11120",
      phoneNumber: "",
      status: "available"
    },
    {
      name: "Henry Spring",
      extensionNumber: "11122",
      phoneNumber: "",
      status: "available"
    },
    {
      name: "Jennifer Lopez",
      extensionNumber: "11119",
      phoneNumber: "",
      status: "busy"
    }
]

let screeningCategory = "products"

function PhoneEngine() {
  this.softphone = null
  this.activeCalls = []
  this.manager = {
    status: "Available", // ["Available", "OaC", "Busy", "DnD"]
    phoneNumber: "",
    flipPhone: "*3",
    waitList: []
  }
  return this
}

PhoneEngine.prototype = {
  initializePhoneEngine: async function(){
    this.rules = {}
    this.softphone = new Softphone({
      username: process.env.SIP_INFO_USERNAME,
      password: process.env.SIP_INFO_PASSWORD,
      authorizationId: process.env.SIP_INFO_AUTHORIZATION_ID,
    });

    if (this.softphone){
      console.log("Has been initialized")
    }else{
      console.log("SP initialization failed")
      return
    }

    try {
      await this.softphone.register();
      console.log("register phone Done")
      // detect inbound call
      this.softphone.on('invite', async (sipMessage) => {

        console.log("SIP Invite")
        var headers = sipMessage.headers
        //console.log(headers)
        // parse header to grab the from phone number
        //  "Contact": "<sip:6502245476@104.245.57.195:5091;transport=tcp>",
        var fromNumber = headers['Contact'].substring(5, headers['Contact'].indexOf('@'))
        console.log(fromNumber)
        // answer the call
        var callSession = await this.softphone.answer(sipMessage);
        // detect blocked caller
        if (this.detectBlockedCaller(fromNumber)){
          console.log("known blocked number => terminate the call immediately")
          callSession.hangup()
          return
        }
        //var activeCall = this.createActiveCall_old(callSession, headers['Call-Id'], fromNumber)
        var activeCall = this.createActiveCall(callSession, fromNumber)
        //await this.getCallInfo(activeCall)
        await sleep(2000)
        this.getCallInfo(activeCall)
        // Create Watson engine
        activeCall.watsonEngine.createWatsonSocket(8000, (err, res) => {
            if (!err) {
              activeCall.watsonEngineReady = true
              console.log("WatsonSocket created! " + res)
              //this._playRecordedResponse(activeCall, "greeting.wav")
            }else{
              console.log("WatsonSocket creation failed!!!!!")
            }
        })

        activeCall.callSession.on('audioPacket', (rtpPacket) => {
            if (activeCall.audioBuffer != null){
                activeCall.audioBuffer = Buffer.concat([activeCall.audioBuffer, Buffer.from(rtpPacket.payload)])
                //console.log(Buffer.byteLength(buffer))
            }else{
                activeCall.audioBuffer = Buffer.from(rtpPacket.payload)
                //console.log(Buffer.byteLength(activeCall.audioBuffer))
            }
            if (activeCall.audioBuffer.length > MAXBUFFERSIZE){
                if (activeCall.watsonEngineReady){
                  activeCall.callWatsonCount++
                  //console.log("Call watson", activeCall.callWatsonCount)
                  activeCall.watsonEngine.transcribe(activeCall.audioBuffer)
                }else
                    console.log(`Dumping data of party`)
                activeCall.audioBuffer = null
            }
        });

        // Either the agent or the customer hang up
        activeCall.callSession.once('disposed', () => {
          console.log("RECEIVE BYE MESSAGE => Hanged up now for this channel:")
          activeCall.isConnected = false
          activeCall.watsonEngine.closeConnection()
          /*
          let index = this.activeCalls.findIndex(o => o.callId == activeCall.callId)
          if (index >= 0){
            console.log(`remove active call at ${index}`)
            this.activeCalls.splice(index, 1)
          }
          */
          //activeCall = null
        });
      });
    }catch(e){
      console.log("FAILED REGISTER?")
      console.log(e)
    }
  },
  setRules: function(rules){
    this.rules = rules
  },
  getCustomerByPhoneNumber: function(phoneNumber){
    let customer = customersList.find(o => o.phoneNumber === phoneNumber)
    return customer
  },
  getCustomerBySSN: function(ssn){
    let customer = customersList.find(o => o.ssn === ssn)
    return customer
  },
  getCustomerByDOB: function(dob){
    let customer = customersList.find(o => o.dob === dob)
    return customer
  },
  readSettings: function (type){
    var json = fs.readFileSync("products-services.json", "utf8")
    var jsonObj = JSON.parse(json)
    for (var item of jsonObj){
      if (item.type == type){
        console.log("supported services are:", item.names)
        return item.names
      }
    }
    return []
  },
  detectBlockedCaller: function(fromNumber){
    let fraud = fraudNumbers.includes(fromNumber)
    if (fraud){
        return true
    }
  },
  setManagerStatus: async function(eventObj){
    if (eventObj.telephonyStatus == "Ringing")
      return
    //console.log(eventObj)
    //if (eventObj.telephonyStatus == "CallConnected"){
      if (eventObj.hasOwnProperty('activeCalls') && eventObj.activeCalls.length){
        //console.log(this.activeCalls)
        var found = true
        for (var ac of eventObj.activeCalls){
          var index = this.activeCalls.findIndex(o => o.callId == ac.id)
          if (index >= 0){
            if (ac.terminationType ==  'final'){
              console.log(`remove active call at ${index}`)
              this.activeCalls.splice(index, 1)
            }else{
              console.log("second waiting call")
            }
            //if (found)
            //  found = true
          }else{
            found = false
            if (ac.terminationType ==  'final'){
              eventObj.presenceStatus = "Available"
              break
            }
          }
        }
        if (found){
          console.log("This is the event of one of the assistant calls")
          if (eventObj.userStatus == "Busy")
            return
        }
        console.log("This is a new call or a flip call event")
        this.manager.status = eventObj.userStatus //eventObj.userStatus //
        if (this.manager.status == "Available"){
          // find activeCall that has a customer waiting. Implement priority later
          var callId = undefined
          if (this.manager.waitList.length){
            //var callId = this.manager.waitList[0].callId
          //}
          //if (callId){
            console.log(this.manager)
              var callId = this.manager.waitList.shift()
              console.log(this.manager)
              var activeCall = this.activeCalls.find(o => o.callId == callId)
              if (activeCall){
                activeCall.conversationStatus = "talking"
                console.log("The manager is available => connect this customer")
                activeCall.streamer.stop()
                //activeCall.customerWaiting = false
                await this._playInlineResponse(activeCall, `Thank you for your patience Mr. ${activeCall.customerInfo.name}, my boss is available now. I will transfer your call in a moment, please stay on the line.`)
                while (!activeCall.streamer.finished){
                  await sleep(1000)
                }
                //await sleep(6000)
                this.forwardCallToTheBoss(activeCall)
              }else{
                console.log("Caller hanged up")
              }
          }else {
              console.log("No waiting customer")
          }
          /*
          var activeCall = this.activeCalls.find(o => o.customerWaiting == true)
          if (activeCall){
            activeCall.conversationStatus = "talking"
            console.log("The manager is available => connect this customer")
            activeCall.streamer.stop()
            activeCall.customerWaiting = false
            await sleep(5000)
            this.forwardCallToTheBoss(activeCall)
          }else{
            console.log("Caller hanged up")
          }
          */
        }
      }else{
        //this.manager.status = eventObj.userStatus
      }
    console.log(this.manager.status)
    //}
    //if (eventObj.presenceStatus == "Busy" && eventObj.userStatus == "Busy")

  },
  createActiveCall: function(callSession, fromNumber){
    let customer = this.getCustomerByPhoneNumber(fromNumber)
    console.log("customer", customer)
    var activeCall = {
      callId: callSession.callId,
      callSession: callSession,
      transcript: "",
      //customerWaiting: false,
      streamer: null,
      isConnected: true,
      watsonEngine: new WatsonEngine(this, callSession.callId),
      watsonEngineReady: false,
      callWatsonCount: 0,
      audioBuffer: null,
      assistantEngine: new AssistantEngine(),
      fromNumber: fromNumber,
      telSessionId: "",
      partyId: "",
      conversationStatus: "screening",
      screeningRules: this.rules,
      currentScreeningRule: null,
      currentScreeningStatus: 'passed',
      conversationStates: new ConversationStates(),
      screeningKeywords: this.readSettings(screeningCategory),
      verifyType: "dob", // "ssn, zipcode", dob
      passCode: "",
      customerInfo: undefined,
      screeningFailedCount: 0,
      maxScreeningFailedCount: 3
    }
    if (customer){ // known number
      activeCall.customerInfo = customer
      if (this.rules.customer_verification.active){
        activeCall.conversationStates.setMainState("customer_verification")
        //activeCall.currentScreeningStatus = "customer_verification"
        //this._setCurrentScreeningStatus(activeCall)
        activeCall.currentScreeningRule = this.rules.customer_verification
        var message = "Thank you for your call. Before continue,"
        if (activeCall.currentScreeningRule.screening_mode == "ssn"){
          message += " can you tell me the last 4 digits of your social security number?"
        }else if (activeCall.currentScreeningRule.screening_mode == "dob"){
          //this._playRecordedResponse(activeCall, "screening-dob.wav")
          message += " can you tell me your date of birth?"
        }
        await this._playInlineResponse(activeCall, message)
      }else{
        activeCall.conversationStatus = "talking"
        activeCall.currentScreeningStatus = "passed"
        this._playInlineResponse(activeCall, `Thank you for your call Mr. ${activeCall.customerInfo.name}, how can I help you today?`)
      }
    }else{ // unknown number => check rules
      if (this.rules.robocall_defend.active){
        activeCall.conversationStates.setMainState("robocall_defend")
        //activeCall.currentScreeningStatus = "robocall_defend"
        //this._setCurrentScreeningStatus(activeCall)
        activeCall.currentScreeningRule = this.rules.robocall_defend
        if (activeCall.currentScreeningRule.screening_mode == "passcode"){
          activeCall.passCode = makePassCode()
          await this._playInlineResponse(activeCall, `Before continue, please repeat or use the keypad to dial the following number. ${activeCall.passCode}`)
        }else if (activeCall.currentScreeningRule.screening_mode == "services"){
          await this._playInlineResponse(activeCall, 'Before continue, can you tell me one of the name of our services?')
          //this._playRecordedResponse(activeCall, "screening-services.wav")
        }
      }else if (this.rules.telemarketer_defend.active){
        activeCall.conversationStates.setMainState("telemarketer_defend")
        //activeCall.currentScreeningStatus = "telemarketer_defend"
        //this._setCurrentScreeningStatus(activeCall)
        activeCall.currentScreeningRule = this.rules.telemarketer_defend
        var message = ""
        if (this.rules.robocall_defend.active)
          message += "Thank you for your call. "
        else
          message += "Before continue, "
        if (activeCall.currentScreeningRule.screening_mode == "services"){
          message += "Can you tell me the name of one of our services?"

        }else if (activeCall.currentScreeningRule.screening_mode == "products"){
          message += "can you tell me the name of one of our products?"
        }
        await this._playInlineResponse(activeCall, message)
      }else if (this.rules.customer_fraud_defend.active){
        activeCall.conversationStates.setMainState("customer_fraud_defend")
        //activeCall.currentScreeningStatus = "customer_fraud_defend"
        //this._setCurrentScreeningStatus(activeCall)
        activeCall.currentScreeningRule = this.rules.customer_fraud_defend
        var message = ""
        if (this.rules.telemarketer_defend.active || this.rules.robocall_defend.active)
          message += "Thank you for answering my questions! Are you our existing customer?"
        else
          message += "Thank you for your call! Are you our existing customer?"
        activeCall.conversationStates.setMainState("customer_fraud_defend")
        activeCall.conversationStates.setSubState("wait-for-yes-no")

        await this._playInlineResponse(activeCall, message)
      }
    }
    this.activeCalls.push(activeCall)
    return activeCall
  },
  /*
  _setCurrentScreeningStatus: async function(activeCall){
    if (activeCall.currentScreeningStatus == "robocall_defend"){
      activeCall.currentScreeningRule = this.rules.robocall_defend
      if (activeCall.currentScreeningRule.screening_mode == "passcode"){
        activeCall.passCode = makePassCode()
        await this._playInlineResponse(activeCall, `Before continue, please repeat or use the keypad to dial the following number. ${activeCall.passCode}`)
      }else if (activeCall.currentScreeningRule.screening_mode == "services"){
        await this._playInlineResponse(activeCall, 'Before continue, can you tell me one of the name of our services?')
        //this._playRecordedResponse(activeCall, "screening-services.wav")
      }
    }else if (activeCall.currentScreeningStatus == "telemarketer_defend"){
      activeCall.currentScreeningRule = this.rules.telemarketer_defend
      var message = ""
      if (this.rules.robocall_defend.active)
        message += "Thank you for your call. "
      else
        message += "Before continue, "
      if (activeCall.currentScreeningRule.screening_mode == "services"){
        message += "Can you tell me the name of one of our services?"

      }else if (activeCall.currentScreeningRule.screening_mode == "products"){
        message += "can you tell me the name of one of our products?"
      }
      await this._playInlineResponse(activeCall, message)
    }else if (activeCall.currentScreeningStatus == "customer_fraud_defend"){
      activeCall.currentScreeningRule = this.rules.customer_fraud_defend
      var message = ""
      if (this.rules.telemarketer_defend.active || this.rules.robocall_defend.active)
        message += "Thank you for answering my questions! Are you our existing customer?"
      else
        message += "Thank you for your call! Are you our existing customer?"
      /// move these to next step if the answer is yes
      if (activeCall.currentScreeningRule.screening_mode == "ssn"){
        message += "If you are an existing customer, can you tell me the last 4 digits of your social security number?"
      }else if (activeCall.currentScreeningRule.screening_mode == "dob"){
        //this._playRecordedResponse(activeCall, "screening-dob.wav")
        message += "If you are an existing customer, can you tell me your date of birth?"
      }
      ///
      activeCall.conversationStates.setMainState("customer_fraud_defend")
      activeCall.conversationStates.setSubState("wait-for-yes-no")

      await this._playInlineResponse(activeCall, message)
    }else if (activeCall.currentScreeningStatus == "customer_verification"){
      activeCall.currentScreeningRule = this.rules.customer_verification
      var message = "Thank you for your call. Before continue,"
      if (activeCall.currentScreeningRule.screening_mode == "ssn"){
        message += " can you tell me the last 4 digits of your social security number?"
      }else if (activeCall.currentScreeningRule.screening_mode == "dob"){
        //this._playRecordedResponse(activeCall, "screening-dob.wav")
        message += " can you tell me your date of birth?"
      }
      await this._playInlineResponse(activeCall, message)
    }
  },
  */
  transcriptReady: async function(callId, transcript){
    var activeCall = this.activeCalls.find(o => o.callId === callId)
    if (activeCall){
      if (transcript.text.length == 0)
        return
      if (activeCall.customerInfo)
        transcript.name = activeCall.customerInfo.name
      else
        transcript.name = activeCall.fromNumber
      server.sendTranscriptEvents(transcript)
      activeCall.transcript += `${transcript.text.toLowerCase()} `
      console.log(callId,":", activeCall.transcript)
      //console.log("Status", activeCall.conversationStatus)
      //console.log("Screening status", activeCall.currentScreeningStatus)

      switch (activeCall.currentScreeningStatus) {
        case "robocall_defend":
          if (activeCall.streamer && !activeCall.streamer.finished){
            console.log("Overlapping talk ...")
            return
          }

          if (activeCall.transcript.indexOf(activeCall.passCode) >= 0){
            activeCall.screeningFailedCount = 0
            if (this.rules.telemarketer_defend.active){
              activeCall.currentScreeningStatus = "telemarketer_defend"
              this._setCurrentScreeningStatus(activeCall)
            }else if (this.rules.customer_fraud_defend.active){
              activeCall.currentScreeningStatus = "customer_fraud_defend"
              this._setCurrentScreeningStatus(activeCall)
            }
          }else{
            // reject this call
            console.log("Reject this call after max failure times")
            activeCall.screeningFailedCount++
            if (activeCall.screeningFailedCount >= activeCall.maxScreeningFailedCount){
              console.log("Reject and hangup")
              activeCall.callSession.hangup()
            }else{
              this._playInlineResponse(activeCall, `Sorry, I cannot hear you well. Can you repeat the number ${activeCall.passCode}?`)
            }
          }
          activeCall.transcript = ""
          return
        case "telemarketer_defend":
          if (activeCall.streamer && !activeCall.streamer.finished){
            console.log("Overlapping talk ...")
            return
          }

          var passed = false
          if (activeCall.currentScreeningRule.screening_mode == "services"){
            for (var keyword of activeCall.screeningKeywords){
              if (activeCall.transcript.indexOf(keyword) >= 0){
                passed = true
                //activeCall.conversationStatus = "verifying"
                break
              }
            }
            activeCall.transcript = ""
            if (passed){
              activeCall.screeningFailedCount = 0
              if (this.rules.customer_fraud_defend.active){
                activeCall.currentScreeningStatus = "customer_fraud_defend"
                this._setCurrentScreeningStatus(activeCall)
              }else{
                // Can continue depend on customer_fraud_defend rule
                if (activeCall.currentScreeningRule.accept_action == "transfer"){
                  console.log("Transfer this call ...")
                }else{
                  console.log("What is the mode, talk to a bot for self services?")
                }
              }
            }else{
              this._playRecordedResponse(activeCall, "screening-services.wav")
              activeCall.screeningFailedCount++
              // wait or try 2 more times then terminate the call if does not the pass screening
              if (activeCall.screeningFailedCount >= activeCall.maxScreeningFailedCount){
                // terminate the call
                activeCall.callSession.hangup()
              }
              return
            }
          }else if(activeCall.currentScreeningRule.screening_mode == "products"){
            for (var keyword of activeCall.screeningKeywords){
              if (activeCall.transcript.indexOf(keyword) >= 0){
                passed = true
                //activeCall.conversationStatus = "verifying"
                break
              }
            }
            activeCall.transcript = ""
            if (passed){
              activeCall.screeningFailedCount = 0
              if (this.rules.customer_fraud_defend.active){
                activeCall.currentScreeningStatus = "customer_fraud_defend"
                this._setCurrentScreeningStatus(activeCall)
              }else{
                // Can continue depend on customer_fraud_defend rule
                if (activeCall.currentScreeningRule.accept_action == "transfer"){
                  console.log("Transfer this call ...")
                }else{
                  console.log("What is the mode, talk to a bot for self services?")
                }
              }
            }else{
              this._playRecordedResponse(activeCall, "screening-products.wav")
              activeCall.screeningFailedCount++
              // wait or try 2 more times then terminate the call if does not the pass screening
              if (activeCall.screeningFailedCount >= activeCall.maxScreeningFailedCount){
                // terminate the call
                activeCall.callSession.hangup()
              }
              return
            }
          }
          return
        case "customer_fraud_defend":
          if (activeCall.streamer && !activeCall.streamer.finished){
            console.log("Overlapping talk ...")
            return
          }

          var words = activeCall.transcript.split(" ")
          console.log(activeCall.transcript)
          if (activeCall.conversationStatus == "screening"){
            var matched = false
            var customerObj = null
            if (activeCall.currentScreeningRule.screening_mode == "ssn"){

              console.log("verify customer ssn", words)
              for (var word of words){
                if (!isNaN(word)){
                  customerObj = this.getCustomerBySSN(word) //customersList.find(o => o.ssn === word)
                  if (customerObj)
                    break
                }
              }
            }else{
              var message = `Get the date in MM/DD/YYYY format from this text string? ${activeCall.transcript}`
              var response = await activeCall.assistantEngine.getAnswer('text', message)
              //var dobs = response.split(" ")
              response = response.trim()
              //console.log("preset customer dobs", activeCall.customerInfo.dob)
              console.log("verify customer dobs", response)
              var words = response.split(" ")
              for (var word of words){
                console.log(word)
                //if (!isNaN(word)){
                customerObj = this.getCustomerByDOB(word) //customersList.find(o => o.dob == word)
                if (customerObj)
                  break
                //}
              }
            }
            activeCall.transcript = ""
            if (customerObj){
              activeCall.customerInfo = customerObj
              activeCall.conversationStatus = "verifying"
              console.log("Ready to talk, But need to verify old phone")
              this._playInlineResponse(activeCall, "Thank you, I found a different phone number from your profile? Can you tell me your old phone number?")
            }else{
              // wait or try 2 more times then terminate the call if does not the pass screening
              if (activeCall.screeningFailedCount >= activeCall.maxScreeningFailedCount){
                // switch to DoB mode
                console.log("Cannot find any customer with this ssn number => repeat checking or hangup")
                if (activeCall.currentScreeningRule.index == 0){
                  activeCall.currentScreeningRule.index = 1
                  activeCall.screeningFailedCount = 0
                  this._playInlineResponse(activeCall, "Sorry, I cannot find a customer with this social security number. Can you tell me your date of birth?")
                }else{
                  this._playInlineResponse(activeCall, "Sorry, I cannot find your customer profile? Let me transfer you to our customer support.")
                  // transfer call to a call queue
                  activeCall.callSession.hangup()
                }
              }else{
                activeCall.screeningFailedCount++
                this._playInlineResponse(activeCall, "Sorry, I cannot hear you well. Can you repeat it?")
              }
            }
          }else if (activeCall.conversationStatus == "verifying"){
            var customerObj = null
            for (var word of words){
              word = word.replace(/-/g, "")
              console.log("word", word)
              if (!isNaN(word)){
                customerObj = this.getCustomerByPhoneNumber(word) //customersList.find(o => o.phoneNumber === word)
                if (customerObj)
                  break
              }
            }
            if (customerObj){
              // verify existing phone number
              activeCall.conversationStatus = "talking"
              activeCall.currentScreeningStatus = "passed"
              this._playInlineResponse(activeCall, `Thank you Mr. ${customerObj.name}, how can I help you today?`)
              console.log("Thank you. do you want to update this phone number in your profile?")
            }else{
              console.log("Failed to verify old phone number.")
              activeCall.conversationStatus = "chatting"
              activeCall.currentScreeningStatus = "passed"
              this._playInlineResponse(activeCall, "Sorry, I cannot verify your information. But how can I help you today?")
            }
          }
          return
        case "customer_verification":
          if (activeCall.streamer && !activeCall.streamer.finished){
            console.log("Overlapping talk ...")
            return
          }

          var matched = false
          if (activeCall.currentScreeningRule.screening_mode == "ssn"){
            //var message = `Determine if the text between the triple dashes contain number that equals to the number between the triple quotes ---${activeCall.transcript.trim()}--- """${activeCall.customerInfo.ssn}""". Provide in JSON format where the key is "matched" and the value is either true if found and false if not found. And the the second key is "ssn" and the value is the detected number.`
            var message = `Find a number from the text between the triple dashes and compare it with the number from the text between the triple quotes ---${activeCall.transcript.trim()}--- """${activeCall.customerInfo.ssn}""". Provide in JSON format where the key is "matched" and the value is either true if the numbers equal and false if not equal. And the the second key is "ssn" and the value is the detected number.`
            console.log(message)
            var checkResult = await activeCall.assistantEngine.getClassifiedTask("JSON", message)
            console.log(checkResult)
            if (checkResult){
              console.log(checkResult.matched)
              if (checkResult.matched){
                matched = true
              }else{
                console.log("not matched")
              }
            }
          }else{
            var message = `Get the date in MM/DD/YYYY format from this text string? ${activeCall.transcript}`
            var response = await activeCall.assistantEngine.getAnswer('text', message)
            //var dobs = response.split(" ")
            response = response.trim()
            //console.log("preset customer dobs", activeCall.customerInfo.dob)
            console.log("verify customer dobs", response)
            var words = response.split(" ")
            for (var word of words){
              console.log(word)
              if (activeCall.customerInfo.dob === word){
                matched = true
                break
              }
            }
          }
          activeCall.transcript = ""

          if (!matched){
              this._playRecordedResponse(activeCall, "screening-ssn.wav")
              return
          }else {
            activeCall.conversationStatus = "talking"
            activeCall.currentScreeningStatus = "passed"
            console.log("Ready to talk, transfer or do whatever after passing screening")
            await this._playInlineResponse(activeCall, `Thank you for your verification mr. ${activeCall.customerInfo.name}. How can I help you today?`)
          }
          break
        case "passed":
        /*
        this.PASSED_MAIN_STATES = [
          "chatting", // => customer talks to the assistant
          "waiting-for-transfer", // => assistant asks for confirmation if the customer wants to transfer the call to a person
          "wait-on-the-line", // => customer decicides to wait on the line. Customer still can talk to the assistant
        ]

        this.PASSED_SUB_STATES = [
          "no-action", // Normal conversation between the assistant and a customer
          "ask-for-transfer", // => customer asked for call transfer =>
          "wait-for-decision", // => bot is waiting for customer's decision
          "wait-for-clarification", // => bot is waiting for customer to clarify his question
        ]
        */
          let mainState = activeCall.conversationStates.getMainState()
          if (mainState == 'chatting'){
            this._handleChattingConversation(activeCall)
          }else if (mainState == 'call-transfer-request'){
            this._handleCallTransferRequest(activeCall)
          }else if (mainState == 'call-forward-request'){
            this._handleCallForwardRequest(activeCall)
          }else if (mainState == 'wait-on-the-line'){
            this._handleCustomerWaitingState(activeCall)
          }else if (mainState == 'request-call-back'){
            this._handleCallbackRequestState(activeCall)
          }else if (mainState == 'wait-on-the-line-option')
            this._handleWaitOnlineOptions(activeCall)
          return

          if (activeCall.conversationStatus == "waiting"){
            // Customer is talking while waiting
            await this._handleCustomerWaitingState()
            activeCall.transcript = ""
            return
          }else if (activeCall.conversationStatus == "checking-to-wait-for-manager"){
            var message = `Determine if the text between the triple dashes means yes or no ---${activeCall.transcript.trim()}---. Provide in JSON format where the key is "answer" and the value is either 1 for yes and 0 for no`
            var result = await activeCall.assistantEngine.getClassifiedTask("JSON", message)
            console.log("====", result)
            if (result.answer == 1){
              //activeCall.customerWaiting = true
              activeCall.conversationStatus = "waiting"
              this.manager.waitList.push(activeCall.callId)
              console.log(this.manager.waitList)
              var index = this.manager.waitList.length
              var position = "You are "
              if (index == 1)
                position += " the next person on the line."
              else if (index == 2)
                position += " the second person on the line."
              else if (index == 3)
                  position += " the third person on the waiting list."
              else{
                position = ` There are ${index} more persons waiting before you.`
              }
              await this._playInlineResponse(activeCall, `Mr. ${activeCall.customerInfo.name}, thank you for your patience! Please stay on the line and I will connect you when the manager is available. ${position}`)
              while (!activeCall.streamer.finished){
                await sleep(1000)
              }
              // play music and wait
              await this._playRecordedResponse(activeCall, "wait-music.wav")
            // }
            // if (activeCall.transcript.indexOf("yes") >= 0 || activeCall.transcript.indexOf("i can wait") >= 0){
            //   activeCall.customerWaiting = true
            //   await this._playInlineResponse(activeCall, `Mr. ${activeCall.customerInfo.name}, thank you for your patience! Please stay on the line and I will connect you when the manager is available.`)
            //   while (!activeCall.streamer.finished){
            //     await sleep(1000)
            //   }
            //   // play music and wait
            //   await this._playRecordedResponse(activeCall, "wait-music.wav")
            }else{
              //activeCall.customerWaiting = false
              activeCall.conversationStatus = "checking-to-callback"
              await this._playInlineResponse(activeCall, `Do you want to call back later or do you want to leave a message to the manager?`)
            }
          }

          var result = await this._getActions(activeCall.assistantEngine, activeCall.transcript)
          console.log(result)
          switch (result.intent) {
            case "answer":
              if (result.decision == "yes"){
                  console.log("Get the yes answer!")
              }
              break;
            case "question":
                this._playInlineResponse(activeCall, `Do you want to know your ${result.topic}?`)
              break;
            case "request":
                this._playInlineResponse(activeCall, `So you want to ${result.topic}?`)
              break;
            default:
              break
          }
          activeCall.transcript = ""
          return
          if (activeCall.conversationStatus == "checking-to-wait-for-manager"){
            var message = `Determine if the text between the triple dashes means yes or no ---${activeCall.transcript.trim()}---. Provide in JSON format where the key is "answer" and the value is either 1 for yes and 0 for no`
            var result = await activeCall.assistantEngine.getClassifiedTask("JSON", message)
            console.log("====", result)
            if (result.answer == 1){
              //activeCall.customerWaiting = true
              activeCall.conversationStatus = "waiting"
              this.manager.waitList.push(activeCall.callId)
              console.log(this.manager.waitList)
              var index = this.manager.waitList.length
              var position = "You are "
              if (index == 1)
                position += " the next person on the line."
              else if (index == 2)
                position += " the second person on the line."
              else if (index == 3)
                  position += " the third person on the waiting list."
              else{
                position = ` There are ${index} more persons waiting before you.`
              }
              await this._playInlineResponse(activeCall, `Mr. ${activeCall.customerInfo.name}, thank you for your patience! Please stay on the line and I will connect you when my boss available. ${position}`)
              while (!activeCall.streamer.finished){
                await sleep(1000)
              }
              // play music and wait
              await this._playRecordedResponse(activeCall, "wait-music.wav")
            // }
            // if (activeCall.transcript.indexOf("yes") >= 0 || activeCall.transcript.indexOf("i can wait") >= 0){
            //   activeCall.customerWaiting = true
            //   await this._playInlineResponse(activeCall, `Mr. ${activeCall.customerInfo.name}, thank you for your patience! Please stay on the line and I will connect you when the manager is available.`)
            //   while (!activeCall.streamer.finished){
            //     await sleep(1000)
            //   }
            //   // play music and wait
            //   await this._playRecordedResponse(activeCall, "wait-music.wav")
            }else{
              //activeCall.customerWaiting = false
              activeCall.conversationStatus = "checking-to-callback"
              await this._playInlineResponse(activeCall, `Do you want to call back later or do you want to leave a message to the manager?`)
            }
          }else{
            await this._handleConversation(activeCall)
          }
          activeCall.transcript = ""
          break
        default: // blocked
          break
      }
    }else{
      console.log("Why no active all found?")
    }
    return
  },
  _handleChattingConversation: async function(activeCall){
    if (activeCall.streamer && !activeCall.streamer.finished){
      return
    }
    let subState = activeCall.conversationStates.getSubState()
    if (subState == "wait-for-decision")
    if (active)
    if (activeCall.transcript.split(" ").length < 5){
      console.log("too little text to process")
      return
    }
    var action = await this._getActions(activeCall.assistantEngine, activeCall.transcript)
    console.log(action)
    // if action is call transfer request => change main state to "waiting-for-transfer"
    switch (action.intent) {
      case 'request':
        if (action.topic == "unknown"){
          // asking for clarification
          this._playInlineResponse(activeCall, "Sorry I don't understand what you said. Can you say it again?")
        }else{
          if (callTransferRequests.find(o => o === action.topic)){
          //if (action.topic.indexOf("transfer") >= 0 || action.topic.indexOf("speaking to") >= 0 || action.topic.indexOf("talking to") >= 0 /*action.topic == "call transfer"*/){
            // play confirm
            activeCall.conversationStates.setMainState("call-transfer-request")
            this._playInlineResponse(activeCall, "Do you want to talk to my boss?")
            activeCall.conversationStates.setSubState("wait-for-yes-no")
          } else if (callForwardRequests.find(o => action.topic.indexOf(o))){
            activeCall.conversationStates.setMainState("call-forward-request")
            this._playInlineResponse(activeCall, "Do you want me to forward your call to an agent?")
            activeCall.conversationStates.setSubState("wait-for-yes-no")
          }else {
            var buf = await activeCall.assistantEngine.getAnswer("speech", activeCall.transcript)
            await this._playAudioBufferResponse(activeCall, buf, true)
          }
        }
        break;
      case 'question':
        if (action.topic == "unknown"){
            // asking for clarification
            this._playInlineResponse(activeCall, "Sorry I don't understand your question. Can you repeat it?")
        }else{
          if (callTransferRequests.find(o => o === action.topic)){
          //if (action.topic.indexOf("transfer") >= 0 || action.topic.indexOf("speaking to") >= 0){
              // play confirm
              this._playInlineResponse(activeCall, "If you want to talk to a person, say I want to transfer my call.")
          }else {
              // get topic
              var buf = await activeCall.assistantEngine.getAnswer("speech", activeCall.transcript)
              await this._playAudioBufferResponse(activeCall, buf, true)
          }
        }
        break;
      case 'answer':
        if (callTransferRequests.findIndex(o => o === action.topic)){
          //if (action.topic == "call transfer"){
            // play confirm
        }else if (action.topic == "unknown"){
          // asking for clarification
          this._playInlineResponse(activeCall, "Sorry I don't understand you mean, Can you say it again?")
        }else{
          // get topic
          this._playInlineResponse(activeCall, "You can ask me any question, I will try to help you at my best.")
        }
        break;
      default: // neutral or something else
        await this._playInlineResponse(activeCall, "Sorry, I can't hear you well, can you repeat it?")
        break
    }
    activeCall.transcript = ""
  },
  _handleCallTransferRequest: async function (activeCall){
    console.log(this.manager)
    let subState = activeCall.conversationStates.getSubState()
    let decision = await this._getYesOrNo(activeCall.assistantEngine, activeCall.transcript)
    if (!decision){
      await this._playInlineResponse(activeCall, "Sorry, Can you repeat it?")
      activeCall.transcript = ""
      return
    }
    console.log("desicion", decision)
    if (decision.answer == 1){
      if (subState == "wait-for-yes-no"){
        if (this.manager.status == "Available"){
            await this._playInlineResponse(activeCall, "Ok, let me transfer your call to my boss. Please stay on the line.")
            await sleep(5000)
            this.forwardCallToTheBoss(activeCall)
        }else if (this.manager.status == "DnD"){
            await this._playInlineResponse(activeCall, "Sorry, my boss is out of the office. Do you want to talk to our customer service agent?")
        }else if (this.manager.status == "Busy"){
            activeCall.conversationStates.setSubState("wait-for-wait-decision")
            await this._playInlineResponse(activeCall, "Sorry, my boss is busy at the moment. Do you want to wait on the line?")
        }
      }else if (subState == "wait-for-wait-decision"){
        activeCall.conversationStates.setMainState('wait-on-the-line-option')
        activeCall.conversationStates.setSubState('no-action')
        this.manager.waitList.push(activeCall.callId)
        console.log(this.manager.waitList)
        var index = this.manager.waitList.length
        var position = "You are "
        if (index == 1)
          position += " the next person on the line."
        else if (index == 2)
          position += " the second person on the line."
        else if (index == 3)
            position += " the third person on the waiting list."
        else{
          position = ` There are ${index} more persons waiting before you.`
        }
        await this._playInlineResponse(activeCall, `Mr. ${activeCall.customerInfo.name}, thank you for your patience! Please stay on the line and I will connect you when my boss is available. ${position}. Do you want to listen to music? Or do you want to keep talking with me while waiting on the line?`)
        while (!activeCall.streamer.finished){
          await sleep(1000)
        }
        //await this._playInlineResponse(activeCall, `Mr. ${activeCall.customerInfo.name}, do you want to listen to music, or do you want to keep talking with me while waiting on the line?`)
        // play music and wait
        //await this._playRecordedResponse(activeCall, "wait-music.wav")
      }
    }else{ // it's a no
      activeCall.conversationStates.setMainState('chatting')
      activeCall.conversationStates.setSubState('no-action')
      await this._playInlineResponse(activeCall, "Oh okay, how can I help you?")
    }
    activeCall.transcript = ""
  },
  _handleWaitOnlineOptions: async function(activeCall){
    var result = await this._getActions(activeCall.assistantEngine, activeCall.transcript)
    console.log(result)
    /*
    switch (result.intent) {
      case "answer":
        if (result.decision == "yes"){
            console.log("Get the yes answer!")
        }
        break;
      case "question":
          this._playInlineResponse(activeCall, `Do you want to know your ${result.topic}?`)
        break;
      case "request":
          this._playInlineResponse(activeCall, `So you want to ${result.topic}?`)
        break;
      default:
        break
    }
    */
    activeCall.transcript = ""

    activeCall.conversationStates.setMainState('wait-on-the-line')
    activeCall.conversationStates.setSubState('no-action')

    // play music and wait
    await this._playRecordedResponse(activeCall, "wait-music.wav")
  },
  _handleCallForwardRequest: async function (activeCall){
    let subState = activeCall.conversationStates.getSubState()
    let decision = await this._getYesOrNo(activeCall.assistantEngine, activeCall.transcript)
    if (!decision){
      await this._playInlineResponse(activeCall, "Sorry, Can you repeat it?")
      activeCall.transcript = ""
      return
    }
    console.log("desicion", decision)
    if (decision.answer == 1){
      if (subState == "wait-for-yes-no"){
        await this._playInlineResponse(activeCall, "Ok, let me transfer your call to an agent. Please stay on the line")
        await sleep(5000)
        this.blindTransferCall(activeCall.telSessionId, activeCall.partyId, "11680")
      }
    }else{ // it's a no
      activeCall.conversationStates.setMainState('chatting')
      activeCall.conversationStates.setSubState('no-action')
      await this._playInlineResponse(activeCall, "Oh okay, how can I help you?")
    }
    activeCall.transcript = ""
  },
  _handleCustomerWaitingState: async function(activeCall){
    // create a task list and check case to response
    var action = await this._getActions(activeCall.assistantEngine, activeCall.transcript)
    console.log(action)
    console.log("====")
    if (!action){
      this._playInlineResponse(activeCall, `Sorry can you repeat your question?`, true)
      activeCall.transcript = ""
      return
    }
    switch (action.intent) {
      case 'request':
      case 'question':
        if (action.topic.indexOf("waiting time") >= 0){
          if (activeCall.streamer && !activeCall.streamer.finished){
            console.log("Customer is talking while waiting => pause")
            activeCall.streamer.pause()
            await sleep(3000)
            //this._playInlineResponse(activeCall, `Hi mr. ${activeCall.customerInfo.name}, sorry to keep you waiting. How can I help you?`, true)
          }
          var index = this.manager.waitList.indexOf(activeCall.callId)
          var position = "You are "
          if (index == 0)
            position += " the next person on the line."
          else if (index == 1)
            position += " the second person on the line."
          else if (index == 2)
              position += " the third person on the waiting list."
          else{
            position = ` There are ${index} persons waiting before you.`
          }
          await this._playInlineResponse(activeCall, `Thank you for your patience mr. ${activeCall.customerInfo.name}. ${position}`, true)
          await sleep(10000)
          activeCall.streamer.resume()
          break
        }else if (action.topic.indexOf("call back") >= 0 || action.topic.indexOf("callback") >= 0 || action.topic.indexOf("cancel") >= 0){
          if (activeCall.streamer && !activeCall.streamer.finished){
            console.log("Customer is talking while waiting => pause")
            activeCall.streamer.stop()
            await sleep(2000)
          }
          activeCall.conversationStates.setMainState("request-call-back")
          this._playInlineResponse(activeCall, "Do you want to leave the waiting list and request a call back?")
          activeCall.conversationStates.setSubState("wait-for-yes-no")
        }else if (action.topic == "unknown"){
          // asking for clarification
        }else if (action.topic == "call transfer"){
            // play confirm
            this._playInlineResponse(activeCall, "You are already on the waiting list.")
        }else if (action.topic == "unknown"){
            // asking for clarification
            this._playInlineResponse(activeCall, "How can I help you?")
        }else{
            // get top
            if (activeCall.streamer && !activeCall.streamer.finished){
              console.log("Customer is talking while waiting => pause")
              activeCall.streamer.pause()
              this._playInlineResponse(activeCall, `Hi mr. ${activeCall.customerInfo.name}, sorry for keeping you waiting. How can I help you?`, true)
            }
        }
        break;
      case 'answer':
        if (action.topic == "call transfer"){
            // play confirm
        }else if (action.topic == "unknown"){
            // asking for clarification
        }else{
            // get top
        }
        break;
      default: // neutral or something else

        break
    }
    activeCall.transcript = ""
  },
  _handleCallbackRequestState: async function(activeCall){
    let subState = activeCall.conversationStates.getSubState()
    let decision = await this._getYesOrNo(activeCall.assistantEngine, activeCall.transcript)
    if (!decision){
      await this._playInlineResponse(activeCall, "Sorry, Can you repeat it?")
      activeCall.transcript = ""
      return
    }
    console.log("desicion", decision)
    if (decision.answer == 1){
      if (subState == "wait-for-yes-no"){
        let index = activeCall.waitList.waitList.indexOf(activeCall.callId)
        if (index >= 0){
          console.log(`remove from wait list`)
          activeCall.waitList.waitList.splice(index, 1)
        }
      }else if (subState == "wait-for-wait-decision"){

      }
    }else{ // it's a no
      let prev = activeCall.conversationStates.getPreviousMainState()
      activeCall.conversationStates.setMainState(prev)
      await this._playInlineResponse(activeCall, "How can I help you now?")
    }
    activeCall.transcript = ""
  },
  _getActions: async function(assistantEngine, message){
    var message = `Determine the intent from the text between the triple dashes ---${message}---. Provide in JSON format where the key is "intent" and the value is "question" or "answer" or "request", if the intent is not identified, the value is "newtral".`
    message += ' 1. Provide also the topic where the key is "topic" and the value is the topic of the text.'
    message += ' 2. If the intent is "request", provide the desicion in the JSON response where the key is "decision" and the value is "request".'
    message += ' 3. If the intent is "question", provide the desicion in the JSON response where the key is "decision" and the value is "ask question".'
    message += ' 4. If the intent is "answer", determine the decision in the answer and provide the decision in the JSON response where the key is "decision" and the value is "yes" or "no". If the desicion cannot be identified, provide a new question to ask for further explaination in the JSON response where the key is "ask" and the value is the new question.'
    //message += ' 3. If the answer is neutral or unclear, provide the new question to ask for further explaination in the JSON response where the key is "ask" and the value is the new question.'
    return await assistantEngine.getClassifiedTask("JSON", message)
  },
  _getTaskClassifications: async function(assistantEngine, message){
    var message = `Determine the user expectation from the text between the triple dashes ---${message}---. Provide in JSON format where the key is "task" and the value is either 1 if it is a question or 0 if it is not a question.`
    return await assistantEngine.getClassifiedTask("JSON", message)
  },
  _getYesOrNo: async function(assistantEngine, message){
    var message = `Determine if the text between the triple dashes means yes or no ---${message}---. Provide in JSON format where the key is "answer" and the value is either 1 for yes and 0 for no`
    return await assistantEngine.getClassifiedTask("JSON", message)
  },
  _handleConversation: async function(activeCall){
    // highest priority
    var message = `Determine the phrase from the text between the triple dashes ---${activeCall.transcript.trim()}---. Provide in JSON format where the key is "phrase" and the value is either "question" if it is a question or "answer" if it is an answer.`
    console.log (await activeCall.assistantEngine.getClassifiedTask("JSON", message))
    console.log("====")
    if (activeCall.transcript.indexOf("talk to a human") >= 0 || activeCall.transcript.indexOf("speak with a human") >= 0 ||
        activeCall.transcript.indexOf("talk to the manager") >= 0 || activeCall.transcript.indexOf("speak with the manager") >= 0){
      console.log(this.manager)
      if (this.manager.status == "Available"){
        await this._playInlineResponse(activeCall, "Ok, let me transfer your call to my manager. Please stay on the line.")
        await sleep(5000)
        this.forwardCallToTheBoss(activeCall)
      }else if (this.manager.status == "DnD"){
        await this._playInlineResponse(activeCall, "Sorry, the manager is out of the office. Do you want to talk to our customer service agent?")
      }else if (this.manager.status == "Busy"){
        activeCall.conversationStatus = "checking-to-wait-for-manager"
        await this._playInlineResponse(activeCall, "Sorry, the manager is busy at the moment. Do you want to wait on the line?")
      }
      return
    }else if (activeCall.transcript.indexOf("hold on") >= 0){
      if (activeCall.streamer){
        activeCall.streamer.pause()
        //this._playRecordedResponse(activeCall, "what-else.wav")
        await this._playInlineResponse(activeCall, "Sorry, tell me what do you really want?")
        return
      }
    }

    if (activeCall.conversationStatus == "chatting"){
      //this._playInlineResponse(activeCall, "Tell me what is the reason of this call. If you waste my time, I will waste yours.")
      await activeCall.assistantEngine.getAnswer("speech", activeCall.transcript)
      return
    }else if (activeCall.conversationStatus == "talking"){
      if (activeCall.transcript.indexOf("i want to talk to") >= 0 || activeCall.transcript.indexOf("transfer my call") >= 0){
        var agent = undefined //agentsList.find(o => transcript.toLowerCase().indexOf(o.name) >= 0)
        for (a of agentsList){
          if (activeCall.transcript.indexOf(a.name.toLowerCase()) >= 0){
            agent = a
            break
          }
        }
        if (agent){
          console.log(agent)
          if (agent.status == "available"){
            this.blindTransferCall(activeCall.telSessionId, activeCall.partyId, agent.extensionNumber)
            return
          }else{
            console.log("Tell the status of this agent", agent.status)
            activeCall.conversationStatus = "transferring"
            this._playRecordedResponse(activeCall, "agent-unavailable.wav")
          }
        }else{
          activeCall.conversationStatus = "transferring"
          console.log("ask for agent name")
          this._playRecordedResponse(activeCall, "ask-agent-name.wav")
        }
      }else{
        await this._playInlineResponse(activeCall, "If you want to talk to an agent, let me know the name of the agent so I can forward your call.")
        //this._playRecordedResponse(activeCall, "request-agent.wav")
      }
      //console.log("blind transfer this call")
      //this.blindTransferCall(activeCall.telSessionId, activeCall.partyId)
      //return
    }else if (activeCall.conversationStatus == "transferring"){
      var agent = undefined //agentsList.find(o => transcript.toLowerCase().indexOf(o.name) >= 0)
      for (a of agentsList){
        if (activeCall.transcript.indexOf(a.name.toLowerCase()) >= 0){
            agent = a
            break
        }
      }
      if (agent){
        console.log(agent)
        if (agent.status == "available"){
            this.blindTransferCall(activeCall.telSessionId, activeCall.partyId, agent.extensionNumber)
            return
        }else{
            console.log("Tell the status of this agent", agent.status)
            await this._playRecordedResponse(activeCall, "agent-unavailable.wav")
        }
      }else{
        if (activeCall.transcript.indexOf("forget it") >= 0 || activeCall.transcript.indexOf("never mind") >= 0){
          activeCall.conversationStatus = "talking"
          console.log("how to help then")
          await this._playRecordedResponse(activeCall, "what-else.wav")
        }else{
          console.log("ask for agent name")
          await this._playRecordedResponse(activeCall, "ask-agent-name.wav")
        }
      }
    }
  },
  _playInlineResponse: async function(activeCall, message, noControl){
    var item = {
      name: "Assistant",
      //index: 0,
      final: true,
      text: message,
    }
    server.sendTranscriptEvents(item)
    var buf = await activeCall.assistantEngine.getSpeech(message)
    if (!noControl)
      activeCall.streamer = activeCall.callSession.streamAudio(buf);
    else
      activeCall.callSession.streamAudio(buf);
  },
  _playRecordedResponse: function(activeCall, fileName){
    var buf = fs.readFileSync(fileName)
    activeCall.streamer = activeCall.callSession.streamAudio(buf);
  },
  _playAudioBufferResponse: function(activeCall, buf, noControl){
    if (!noControl)
      activeCall.streamer = activeCall.callSession.streamAudio(buf);
    else
      activeCall.callSession.streamAudio(buf);
  },
  talkToCaller: async function(buffer){
    if (this.callSession){
      // // send audio to remote peer
      // const streamer = callSession.streamAudio(fs.readFileSync('demos/test.raw'));
      // await waitFor({ interval: 3000 });
      // // you may interrupt audio sending at any time
      // streamer.stop();
      this.streamer = this.callSession.streamAudio(buffer);
      return "ok"
    }
  },
  getCallInfo: async function(activeCall){
    console.log("getCallInfo")
    try {
      await platform.login({jwt: process.env.RINGCENTRAL_JWT})
      let endpoint = "/restapi/v1.0/account/~/extension/~/active-calls"
      var resp = await platform.get(endpoint, {view: "Detailed"})
      var jsonObj = await resp.json()
      //console.log(jsonObj.records)
      for (var record of jsonObj.records){
        if (record.result == "In Progress"){
          for (var leg of record.legs){
            if (leg.direction == "Inbound"){
              if (leg.from.phoneNumber.indexOf(activeCall.fromNumber) >= 0){
                activeCall.telSessionId = leg.telephonySessionId
                activeCall.partyId = leg.partyId.replace("-1", "-2")
                //activeCall.flipPartyId = leg.partyId.replace("-1", "-2")
                return
              }
            }
          }
          //console.log(record.legs)
          //await this.getCallSessionInfo(record.telephonySessionId)
        }
      }

    }catch(e){
      console.log(e.message)
    }
  },
  getCallSessionInfo: async function(telSessionId){
    try {
      let endpoint = `/restapi/v1.0/account/~/telephony/sessions/${telSessionId}`
      var resp = await platform.get(endpoint)
      var jsonObj = await resp.json()
      console.log("Call session info")
      for (var record of jsonObj.parties){
        //if (record.result == "In Progress"){
          console.log(record)
        //}
      }
    }catch(e){
      console.log(e.message)
    }
  },
  blindTransferCall: async function(telSessionId, partyId, agentExtensionNumber){
    console.log("blindTransferCall")
    //await platform.login({jwt: process.env.RINGCENTRAL_JWT})
    var endpoint = `/restapi/v1.0/account/~/telephony/sessions/${telSessionId}/parties/${partyId}/transfer`
    console.log(endpoint)
    try{
      let bodyParams = {
        //phoneNumber:toNumber
        extensionNumber : agentExtensionNumber
        ////voicemail: toNumber
      }
      console.log(bodyParams)
      var resp = await platform.post(endpoint, bodyParams)
      var jsonObj = await resp.json()
      console.log(JSON.stringify(jsonObj))
      console.log("BLIND TRANSFERRED")
    }catch(e){
      console.log(e.message)
    }
  },
  forwardCallToTheBoss: async function(activeCall){
    console.log("forwardCallToTheBoss")
    //await platform.login({jwt: process.env.RINGCENTRAL_JWT})
    var endpoint = `/restapi/v1.0/account/~/telephony/sessions/${activeCall.telSessionId}/parties/${activeCall.partyId}/flip`
    console.log(endpoint)
    try{
      var resp = await platform.post(endpoint, {
        callFlipId: this.manager.flipPhone
      })
      var jsonObj = await resp.json()
      console.log(JSON.stringify(jsonObj))
      console.log("FLIP PHONE")
      await sleep(5000)
      console.log("Hangup after 5s")
      activeCall.callSession.hangup()
    }catch(e){
      console.log(e.message)
    }
  },
  makeCall: async function(phoneNumber){
    const callSession = await this.softphone.call(phoneNumber);
    // callee answers the call
    callSession.once('answered', async () => {
      // receive audio
      console.log("get answer too early?")
      //return
      /*
      console.log("before answer?")
      console.log(callSession)
      var i = 0
      var timer = setInterval(function(){
        i++
        if (i > 3){
          console.log("after answer?")
          clearInterval(timer)
          console.log(callSession)
          return
        }
        console.log(callSession)
      }, 5000)
      */
      const writeStream = fs.createWriteStream(`test-outbound.raw`, { flags: 'a' });
      callSession.on('audioPacket', (rtpPacket) => {
        // var sum = 0
        // for (var b of rtpPacket.payload){
        //   sum += b
        // }
        // console.log("=> ", sum)
        //console.log("Already call before connected?", rtpPacket.payload)
        writeStream.write(rtpPacket.payload);
      });
      // either you or the peer hang up
      callSession.once('disposed', () => {
        writeStream.close();
      });

      // // send audio to remote peer
      // await sleep(2000);
      // const streamer = callSession.streamAudio(fs.readFileSync('what-else.wav'));
      // await sleep(3000);
      // // you may interrupt audio sending at any time
      // streamer.stop();

      // receive DTMF
      callSession.on('dtmf', (digit) => {
        console.log('dtmf', digit);
      });

      // // send DTMF
      // await waitFor({ interval: 2000 });
      // callSession.sendDTMF('1');
      // await waitFor({ interval: 2000 });
      // callSession.sendDTMF('#');

      // // hang up the call
      // await waitFor({ interval: 5000 });
      // callSession.hangup();

      // // transfer the call
      // await waitFor({ interval: 2000 });
      // await callSession.transfer(process.env.ANOTHER_CALLEE_FOR_TESTING);
    });

    // // cancel the call (before the peer answers)
    // await waitFor({ interval: 8000 });
    // callSession.cancel();
  }
}
module.exports = PhoneEngine;

const sleep = async (ms) => {
  await new Promise(r => setTimeout(r, ms));
}

function makePassCode() {
  var code = "";
  var possible = "0123456789";
  for (var i = 1; i < 5; i++){
    code += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return code;
}


function englishGrammar(searchTerm, attempt) {
	//global $attempt;
	var stem = "";
	let length = searchTerm.length
	if (length > 6) {
		var temp = searchTerm.substring(length - 5, length);
		stem = searchTerm.substring(0, length - 5);
		switch (temp) {
			case 'tting': // dotting
			case 'gging': // hugging
			case 'pping': // stopping
			case 'rring': // tarring
			case 'lling': // controlling
				stem += temp[0]; // sto + pping => sto + p
				return stem;
			}
		}
	if (length > 5) {
		var temp = searchTerm.substring(length - 4, length);
		stem = searchTerm.substring(0, length - 4);
		switch (temp) {
			case 'tted': // dotted
			case 'gged': // hugged
			case 'pped': // stopped
			case 'rred': // tarred
			case 'lled': // controlled
			case 'dded': // embedded
				stem += temp[0]; // sto + pped => sto + p
				return stem;
			}
		}
	if (length > 4) {
		var temp = searchTerm.substring(length - 3, length);
		stem = searchTerm.substring(0, length - 3);
		switch (temp) {
			case 'ing': // speaking -> speak, talking -> talk
				//if (attempt == 0)
				//	return stem + "e";
				//else
        if (stem[stem.length-1] == "c" || stem[stem.length-1] == "s")
          return stem + "e";
        else
					return stem;
			case 'ies': // universities -> university, studies -> study
			case 'ied': // studied -> study
				stem += "y";
				return stem;
			}
		}
	if (length > 3) {
		var temp = searchTerm.substring(length - 2, length);
		stem = searchTerm.substring(0, length - 2);
		switch (temp) {
			// words that end with sh, ss, x
			case "es":	 // crash+es ->  crash, class -> class+es; liv+es -> life; fixes -> fix
				if (stem[stem.length-1] != 's' || stem[stem.length-1] != 'h' || stem[stem.length-1] != 'x'){
					stem += "e";
				}else if (stem[stem.length-1] == 'v'){ // life -> lives; leaf -> leaves ??? he leaves OR the leaves on a tree
					if (attempt == 1)
						stem[stem.length-1] == "f";
					stem += "e";
				}
				return stem;
			case 'ed':	 // separated ->  separate, influenced -> influence, challenged -> challenge
				if (attempt == 0)
					stem += "e"; // first try with e
				return stem;
			case "'s":	 // school's ->  school, class' -> classes
				return stem;
			}
		}
	if (length > 2){
		var temp = searchTerm.substring(length - 1, length);
		stem = searchTerm.substring(0, length - 1);
		switch (temp) {
			// single a
			case "s":	 // schools ->  school, lifts -> lift
			case "'":	 // class' ->  class, loss's -> loss
				return stem;
			}
		}
	// default
	return searchTerm;
}
