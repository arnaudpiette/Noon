const {updateUser}=require('./service');function patchUser(req){return {status:200,body:updateUser(req.params.id,req.body)};}module.exports={patchUser};
