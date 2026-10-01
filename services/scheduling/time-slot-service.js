"use strict";

const { BLUEBERRY_COLOR_ID, DEFAULT_PLANNING_SETTINGS, findFreeSlots } = require("../../lib/morning-brief");
const { localDateRange } = require("../connectors/google-calendar");
function createTimeSlotService(calendarConnector) {
  async function suggest({ durationMinutes, events = null, calendarComplete = true, settings = {}, now = new Date(), days = 7, mode = "Focus", offline = false,
    maximumResults = 3, dueAt = null, preferredTimeOfDay = null }) {
    const config={...DEFAULT_PLANNING_SETTINGS,...settings};let busy=events;
    if (!busy && !offline && !calendarConnector?.connected) {
      const error = new Error("Impossible de calculer des créneaux : l’agenda n’a pas pu être vérifié.");
      error.code = "CALENDAR_AUTH_REQUIRED"; error.statusCode = 409; throw error;
    }
    if (busy && calendarComplete !== true) { const error = new Error("Impossible de calculer des créneaux : l’agenda n’a pas été récupéré complètement."); error.code = "CALENDAR_INCOMPLETE"; throw error; }
    if(!busy&&!offline&&calendarConnector?.connected){const result=await calendarConnector.listCompleteCalendarEvents({calendarId:config.targetCalendarId||"primary",...localDateRange(now,days,config.timeZone||"Europe/Paris")});if(!result.complete){const error=new Error("Impossible de calculer des créneaux : l’agenda n’a pas été récupéré complètement.");error.code="CALENDAR_INCOMPLETE";throw error;}busy=result.items||[];}
    const limit=Math.max(1,Math.min(100,Number(maximumResults)||3));
    busy=busy||[];const slots=[];for(let offset=0;offset<days&&slots.length<limit;offset+=1){const day=new Date(now.getTime()+offset*86_400_000);let candidates=findFreeSlots({day,events:busy,settings:config,durationMinutes,dueAt,notBefore:offset===0?now:null});if(preferredTimeOfDay){candidates=candidates.sort((left,right)=>{const hour=(value)=>new Intl.DateTimeFormat("en-GB",{timeZone:config.timeZone||"Europe/Paris",hour:"2-digit",hour12:false}).format(new Date(value.start));const penalty=(value)=>preferredTimeOfDay==="morning"?(Number(hour(value))<12?0:1):preferredTimeOfDay==="afternoon"?(Number(hour(value))>=13&&Number(hour(value))<18?0:1):Number(hour(value))>=18?0:1;return penalty(left)-penalty(right)||left.start.localeCompare(right.start);});}for(const slot of candidates){slots.push({...slot,mode,colorId:BLUEBERRY_COLOR_ID,reason:`Créneau libre de ${durationMinutes} min compatible avec le mode ${mode}.`,stale:offline});if(slots.length>=limit)break;}}return slots;
  }
  return { suggest };
}
module.exports = { createTimeSlotService };
