"use strict";
const path=require("node:path");
const moduleAt=(root,file)=>require(path.resolve(root,file));
function result(ok,summary){return {status:ok?"PASS":"FAIL",safeSummary:summary,failureCategory:ok?null:"HIDDEN_VALIDATION_FAILURE"};}
function getHiddenValidator(taskId){const validators={
  "normalize-email":(root)=>{const {normalizeEmail}=moduleAt(root,"src/email");try{return result(normalizeEmail("  USER@EXAMPLE.TEST  ")==="user@example.test"&&(()=>{try{normalizeEmail(" ");return false;}catch{return true;}})(),"email edge validation");}catch{return result(false,"email edge validation");}},
  "slugify-title":(root)=>{const {slugifyTitle}=moduleAt(root,"src/slug");try{return result(slugifyTitle("  Many   Words ")==="many-words","slug edge validation");}catch{return result(false,"slug edge validation");}},
  "backend-user-update":(root)=>{const {patchUser}=moduleAt(root,"src/controller");const response=patchUser({params:{id:"missing"},body:{name:"X"}});return result(response.status===404,"missing user validation");},
  "multifile-state-flow":(root)=>{const {create}=moduleAt(root,"src/controller");create({body:{label:"A"}});return result(create({body:{label:"B"}}).body.items.length===2,"state preservation validation");},
};const validator=validators[taskId];if(!validator)throw Object.assign(new Error("Validator hidden inconnu."),{code:"HIDDEN_VALIDATOR_UNKNOWN"});return validator;}
module.exports={getHiddenValidator};
