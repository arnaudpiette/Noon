const store=require('./store');function addItem(label){store.save({items:[{label}]});return store.get();}module.exports={addItem};
