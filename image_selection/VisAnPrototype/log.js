let log = { log: [] };

log.write = function (operation_, obj_, guidance_) {
    this.log.push({
      operation: operation_,
      obj: obj_,
      t: new Date(),
      guidance: guidance_
    })
  }