const {addItem}=require('./service');function create(req){return {status:201,body:addItem(req.body.label)};}module.exports={create};
