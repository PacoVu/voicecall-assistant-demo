require('dotenv').config()
const fs = require('fs')
const RtpPacket = require('werift-rtp')
const Softphone = require('ringcentral-softphone').default
const WatsonEngine = require('./watson-engine.js');
const OpenAIEngine = require('./openai-engine.js');
const RingCentral = require('@ringcentral/sdk').SDK


var MAXBUFFERSIZE = 160 * 50

const rcsdk = new RingCentral({
  server: process.env.RINGCENTRAL_SERVER_URL,
  clientId: process.env.RINGCENTRAL_CLIENT_ID,
  clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET
})

var platform = rcsdk.platform();

class ConversationStates {
  constructor() {
    this.mainState = 'chatting'
    this.subState = 'no-action'
    this.previousMainState = ""
  }
  setMainState(newState){
    this.previousMainState = this.mainState
    this.mainState = newState
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

let blockedNumbers = [
    "234567890",
    "2092841212",
    "6505131145"
]

function PhoneEngine() {
  this.softphone = null
  this.customersList = []
  this.agentsList = []
  return this
}

PhoneEngine.prototype = {
  initializePhoneEngine: async function(){
    var deviceInfo = await this.readPhoneSettings()
    if (deviceInfo)
      this.softphone = new Softphone(deviceInfo);

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
        await this.readCustomersList()
        await this.readAgentsList()
        console.log("SIP Invite")
        var header = sipMessage.headers['Contact']
        var fromNumber = header.substring(5, header.indexOf('@'))

        // answer the call
        var callSession = await this.softphone.answer(sipMessage);

        // detect blocked caller
        if (this.isBlockedCaller(fromNumber)){
          console.log("known blocked number => terminate the call immediately")
          callSession.hangup()
          return
        }
        var activeCall = await this.createActiveCall(callSession, fromNumber)

        // Create Watson socket
        activeCall.watsonEngine.createWatsonSocket((state, transcript) => {
            if (state == "READY") {
              activeCall.watsonEngineReady = true
              console.log("WatsonSocket created!")
            }else if (state == "ERROR"){
              console.log("WatsonSocket creation failed!")
            }else if (state == "INTERIM"){
              if (activeCall.delayTimer != null){
                clearTimeout(activeCall.delayTimer)
                console.log("Reset delay timer")
                activeCall.delayTimer = null
              }
            }else if (state == "FINAL"){
              console.log("Transcript:", transcript)
              if (transcript.length == 0 && activeCall.transcript.length == 0)
                return

              activeCall.transcript += `${transcript.toLowerCase()} `
              this.transcriptReady(activeCall)
            }
        })

        activeCall.callSession.on('audioPacket', (rtpPacket) => {
            if (activeCall.audioBuffer != null){
                activeCall.audioBuffer = Buffer.concat([activeCall.audioBuffer, Buffer.from(rtpPacket.payload)])
            }else{
                activeCall.audioBuffer = Buffer.from(rtpPacket.payload)
            }
            if (activeCall.audioBuffer.length > MAXBUFFERSIZE){
                if (activeCall.watsonEngineReady){
                  activeCall.watsonEngine.transcribe(activeCall.audioBuffer)
                }else
                    console.log(`Dumping data of party`)
                activeCall.audioBuffer = null
            }
        });

        // receive DTMF
        activeCall.callSession.on('dtmf', (digit) => {
          console.log('dtmf', digit);
          this.handleDTMFResponse(activeCall, digit)
        });

        // Either the agent or the customer hang up
        activeCall.callSession.once('disposed', () => {
          console.log("RECEIVE BYE MESSAGE => Hanged up now for this channel:")
          activeCall.isConnected = false
          activeCall.watsonEngine.closeConnection()
          activeCall = null
        });
      });
    }catch(e){
      console.log("FAILED REGISTER?")
      console.log(e)
    }
  },
  login: async function(){
    var loggedIn = await platform.loggedIn()
    if (loggedIn){
      console.log("Still logged in => good to call APIs")
    }else{
      await platform.login({jwt: process.env.RINGCENTRAL_JWT})
    }
  },
  readAgentsList: function(){
    this.agentsList = JSON.parse(fs.readFileSync('./agents.json', 'utf8'))
  },
  readCustomersList: function(){
    this.customersList = JSON.parse(fs.readFileSync('./customers.json', 'utf8'))
  },
  identifyCallerByPhoneNumber: function(phoneNumber){
    let customer = this.customersList.find(o => o.phoneNumber === phoneNumber)
    return customer
  },
  isBlockedCaller: function(fromNumber){
    let blocked = blockedNumbers.includes(fromNumber)
    return (blocked) ? true : false
  },
  createActiveCall: async function(callSession, fromNumber){
    let customer = this.identifyCallerByPhoneNumber(fromNumber)
    var activeCall = {
      fromNumber: fromNumber,
      callSession: callSession,
      telSessionId: "",
      partyId: "",
      transcript: "",
      dtmf: "",
      delayTimer: null,
      assignedAgent: null,
      speechStreamer: null,
      watsonEngine: new WatsonEngine(),
      watsonEngineReady: false,
      audioBuffer: null,
      assistantEngine: new OpenAIEngine(),
      screeningStatus: 'verified', // "robocall_defend" || "verified"
      conversationStates: new ConversationStates(),
      passCode: "",
      customerInfo: customer,
      screeningFailedCount: 0,
      maxScreeningFailedCount: 3
    }
    if (customer){ // known number
      activeCall.screeningStatus = "verified"
      this.playInlineResponse(activeCall, `Thank you for your call Mr. ${activeCall.customerInfo.name}! I can help answer your questions relating to our products and services. I can also forward your call to a proper team or a person if you tell me what you need to know.`)
    }else{ // unknown number => turn on robocall_defend mode
      activeCall.screeningStatus = "robocall_defend"
      activeCall.passCode = makePassCode()
      this.playInlineResponse(activeCall, `Before continue, please repeat or use the keypad to dial the following number. ${activeCall.passCode}`)
    }

    await this.getCallInfo(activeCall)
    return activeCall
  },
  handleDTMFResponse: async function(activeCall, digit){
    switch (activeCall.screeningStatus) {
      case "robocall_defend":
        activeCall.dtmf += digit
        if (activeCall.dtmf.length >= 4){
          if (activeCall.dtmf == activeCall.passCode){
            activeCall.screeningFailedCount = 0
            activeCall.dtmf = ""
            activeCall.screeningStatus = "verified"
            await this.playInlineResponse(activeCall, `Thank you for your verification! I can help answer your questions relating to our products and services. I can also forward your call to a proper team or a person if you tell me what you need to do.`)
          }else{
            // reject this call
            console.log("Reject this call after max failure times")
            activeCall.screeningFailedCount++
            activeCall.dtmf = ""
            if (activeCall.screeningFailedCount >= activeCall.maxScreeningFailedCount){
              console.log("Reject and hangup")
              activeCall.callSession.hangup()
            }else{
              this.playInlineResponse(activeCall, `Sorry, the passcode is incorrect. Can you repeat the number ${activeCall.passCode}?`)
            }
          }
        }
        break
      default:
        break
    }
  },
  transcriptReady: function(activeCall){
    let subState = activeCall.conversationStates.getSubState()
    // Waiting for passcode or yes or no state does not require a delay to get a long answer
    if (activeCall.screeningStatus == 'robocall_defend' || subState == 'wait-for-transfer-decision'){
      if (activeCall.delayTimer != null){
        clearTimeout(activeCall.delayTimer)
        console.log("Reset delay timer")
        activeCall.delayTimer = null
      }
      this.processTranscript(activeCall)
    }else{
      var thisClass = this
      if (activeCall.delayTimer != null){
        clearTimeout(activeCall.delayTimer)
        console.log("Reset delay timer before setting a new one")
      }
      activeCall.delayTimer = setTimeout(function(){
        activeCall.delayTimer = null
        if (activeCall.transcript.length > 0){
          thisClass.processTranscript(activeCall)
        }
      }, 2000)
    }
  },
  processTranscript: async function(activeCall){
    switch (activeCall.screeningStatus) {
      case "robocall_defend":
        while (activeCall.speechStreamer && !activeCall.speechStreamer.finished){
          console.log("Overlapping talk ... => cause delay")
          await sleep(1000)
        }
        var checkResult = await activeCall.assistantEngine.getCodeVerification(activeCall.transcript.trim(), activeCall.passCode)
        console.log(checkResult)
        if (checkResult && checkResult.matched){
          activeCall.screeningStatus = "verified"
          await this.playInlineResponse(activeCall, `Thank you for your verification. I can help answer your questions relating to our products. I can also forward your call to a proper team or a person if you tell me what you need to know.`)
        }else{
          if (activeCall.screeningFailedCount >= activeCall.maxScreeningFailedCount){
            console.log("Reject and hangup")
            activeCall.callSession.hangup()
          }else{
            activeCall.screeningFailedCount++
            this.playInlineResponse(activeCall, `Sorry, the passcodes do not match. Can you repeat the number ${activeCall.passCode}?`)
          }
        }
        activeCall.transcript = ""
        break
      case "customer_verification":
        if (activeCall.speechStreamer && !activeCall.speechStreamer.finished){
          console.log("Overlapping talk ...")
          await sleep(1000)
        }

        if (activeCall.transcript.length < 4)
        return

        var checkResult = await activeCall.assistantEngine.getCodeVerification(activeCall.transcript.trim(), activeCall.customerInfo.ssn)
        console.log(checkResult)
        if (checkResult){
          console.log(checkResult.matched)
          if (checkResult.matched){
            activeCall.screeningStatus = "verified"
            await this.playInlineResponse(activeCall, `Thank you for your verification mr. ${activeCall.customerInfo.name}. I can help answer your questions relating to our products. I can also forward your call to a proper team or a person if you tell me what you need to know.`)
          }else{
            if (activeCall.screeningFailedCount >= activeCall.maxScreeningFailedCount){
              console.log("Cannot find any customer with this ssn number => repeat checking or hangup or transfer the call...")
              this.playInlineResponse(activeCall, "Sorry, I cannot find a customer with this social security number. Let me transfer your call to our customer service?")
              // Decide whatever you want to do. hangup or transfer to a customer support team etc.
            }else{
              activeCall.screeningFailedCount++
              this.playInlineResponse(activeCall, "Sorry, I cannot hear you well. Can you repeat it?")
            }
            return
          }
        }
        activeCall.transcript = ""
        break
      case "verified":
        this.processConversation(activeCall)
        return
      default:
        break
    }
  },
  processConversation: async function(activeCall){
    let mainState = activeCall.conversationStates.getMainState()
    switch (mainState) {
      case 'chatting':
        this.handleChattingConversation(activeCall)
        break;
      case 'call-transfer-request':
        let subState = activeCall.conversationStates.getSubState()
        if (subState == 'transfer-call'){
          console.log("being transferring => ignore this")
          return
        }
        this.handleCallTransferRequest(activeCall)
        break
      default:
        break
    }
  },
  handleChattingConversation: async function(activeCall){
    while (activeCall.speechStreamer && !activeCall.speechStreamer.finished){
      console.log("Overlapping talk ... => cause delay")
      await sleep(1000)
    }
    var action = await activeCall.assistantEngine.getIntents(activeCall.transcript)
    activeCall.transcript = ""

    if (!action){
      console.log("Ask to repeat the question.")
      await this.playInlineResponse(activeCall, "Sorry I cannot hear you well, can you repeat it?")
      return
    }
    console.log("Action", action)
    switch (action.intent) {
      case 'request':
        if (action.class == "call transfer"){
          if (action.topic == "ordering"){
            activeCall.assignedAgent = this.agentsList.find(o => o.extensionNumber == "102")
          }else if (action.topic == "billing"){
            activeCall.assignedAgent = this.agentsList.find(o => o.extensionNumber == "103")
          }else if (action.topic == "technical support"){
            activeCall.assignedAgent = this.agentsList.find(o => o.extensionNumber == "104")
          }else{
            if (action.ask)
              await this.playInlineResponse(activeCall, `${action.ask}`)
            else
              await this.playInlineResponse(activeCall, `Sorry I don't know what you want me to do. Can you repeat your question?`)
            return
          }
          if (activeCall.assignedAgent){
            activeCall.conversationStates.setMainState("call-transfer-request")
            activeCall.conversationStates.setSubState('wait-for-transfer-decision')
            var confirm = `Do you want me to transfer your call to the ${activeCall.assignedAgent.name}?`
            await this.playInlineResponse(activeCall, confirm)
          }else{
            console.log("Cannot find a designated agent to transfer the call! Check the database")
            await this.playInlineResponse(activeCall, "Sorry, I can't find a person who can help you with right now. Please explain again and I will try to help you.")
          }
        }else{
          console.log("No class info => ask to identify the intent")
          if (action.ask)
            await this.playInlineResponse(activeCall, `${action.ask}`)
          else
            await this.playInlineResponse(activeCall, `Sorry I don't know what you want me to do. Can you repeat what you said?`)
        }
        break;
      case 'question':
        if (action.answer)
          await this.playInlineResponse(activeCall, action.answer)
        break;
      case 'answer':
        if (action.ask)
          await this.playInlineResponse(activeCall, action.ask)
        break;
      default: // neutral or something else
        await this.playInlineResponse(activeCall, `Sorry I don't know what you want me to do. Can you explain what said?`)
        break
    }
  },
  handleCallTransferRequest: async function (activeCall){
    let subState = activeCall.conversationStates.getSubState()
    let decision = await activeCall.assistantEngine.getYesOrNoAnswer(activeCall.transcript)
    if (!decision){
      await this.playInlineResponse(activeCall, "Sorry, Can you repeat it?")
      activeCall.transcript = ""
      return
    }
    if (decision.answer == 1){ // It's a yes
        activeCall.conversationStates.setSubState('transfer-call')
        await this.playInlineResponse(activeCall, `Ok, let me transfer your call to ${activeCall.assignedAgent.name}. Please stay on the line.`)
        await sleep(5000)
        this.blindTransferCall(activeCall)
    }else if (decision.answer == 0){ // it's a no
      activeCall.conversationStates.setMainState('chatting')
      activeCall.conversationStates.setSubState('no-action')
      await this.playInlineResponse(activeCall, "Oh okay, how can I help you?")
    }else{
      await this.playInlineResponse(activeCall, "Sorry, can you repeat it?")
    }
    activeCall.transcript = ""
  },
  playInlineResponse: async function(activeCall, message){
    if (activeCall.speechStreamer && !activeCall.speechStreamer.finished){
      console.log("playInlineResponse Overlapping => Must stop")
      activeCall.speechStreamer.stop()
    }
    var buf = await activeCall.assistantEngine.getSpeech(message)
    activeCall.speechStreamer = activeCall.callSession.streamAudio(buf);
  },
  getCallInfo: async function(activeCall){
    try {
      await platform.login({jwt: process.env.RINGCENTRAL_JWT})
      let endpoint = "/restapi/v1.0/account/~/extension/~/active-calls"
      var resp = await platform.get(endpoint, {view: "Detailed"})
      var jsonObj = await resp.json()
      for (var record of jsonObj.records){
        if (record.result == "In Progress"){
          for (var leg of record.legs){
            if (leg.direction == "Inbound"){
              if (leg.from.phoneNumber.indexOf(activeCall.fromNumber) >= 0){
                activeCall.telSessionId = leg.telephonySessionId
                activeCall.partyId = await this.getCallSessionInfo(activeCall, record.telephonySessionId)
                return
              }
            }
          }
        }
      }
    }catch(e){
      console.log(e.message)
    }
  },
  getCallSessionInfo: async function(activeCall, telSessionId){
    try {
      let endpoint = `/restapi/v1.0/account/~/telephony/sessions/${telSessionId}`
      var resp = await platform.get(endpoint)
      var jsonObj = await resp.json()
      for (var party of jsonObj.parties){
        if (party.direction == "Inbound"){
            return party.id
        }
      }
    }catch(e){
      console.log(e.message)
    }
  },
  blindTransferCall: async function(activeCall){
    console.log("blindTransferCall")
    var endpoint = `/restapi/v1.0/account/~/telephony/sessions/${activeCall.telSessionId}/parties/${activeCall.partyId}/transfer`
    try{
      let bodyParams = {
        extensionNumber : activeCall.assignedAgent.extensionNumber
      }
      await this.login()
      var resp = await platform.post(endpoint, bodyParams)
      var jsonObj = await resp.json()
      console.log("Call transferred => Hang up this call.")
      activeCall.callSession.hangup()
    }catch(e){
      console.log(e.message)
      // if failed reset the mainState and subState
      activeCall.conversationStates.setMainState('chatting')
      activeCall.conversationStates.setSubState('no-action')
      await this.playInlineResponse(activeCall, "Sorry, I can't transfer your call right now.")
      // Decide yourself what to do next in this situation
    }
  },
  readPhoneSettings: async function() {
    console.log("readPhoneSettings")
    await this.login()
    try {
        var resp = await platform.get('/restapi/v1.0/account/~/extension/~/device')
        let jsonObj = await resp.json()
        for (var device of jsonObj.records){
          if (device.name == 'IVR Station'){
            resp = await platform.get(`/restapi/v1.0/account/~/device/${device.id}/sip-info`)
            let ivrPhone = await resp.json()
            let deviceInfo = {
                username: ivrPhone.userName,
                password: ivrPhone.password,
                authorizationId: ivrPhone.authorizationId,
            }
            return deviceInfo
          }
        }
        return null
    }catch(e) {
        console.error(e.message);
    }
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
