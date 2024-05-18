let log = { log: [] };

log.write = function (agent, operation_, obj_, guidance_) {
    this.log.push({
      a: agent,
      operation: operation_,
      obj: obj_,
      t: new Date(),
      g: guidance_
    })
  }