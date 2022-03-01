import chalk from 'chalk'
import fs from 'fs'
import loadJsonFile from 'load-json-file'
import isMap from 'lodash/isMap'

import { AWS } from './aws'
import { AWSConfig, MasterConfig } from './config'
import { MasterValidator } from './validator'

export class XyDomainScan {
  private aws = new AWS()

  private config = new MasterConfig('master')

  private validator = new MasterValidator(new MasterConfig('master'))

  private preflight?: string

  private verbose = false

  public async loadConfig(filename: string, defaultConfigFilename: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unused-vars
    function customizer(objValue: any, srcValue: any) {
      if (Array.isArray(objValue)) {
        return objValue.concat(srcValue)
      }
      if (isMap(objValue)) {
        if (isMap(srcValue)) {
          srcValue.forEach((k, v) => {
            objValue.set(k, v)
          })
          return objValue
        }
      }
    }

    try {
      /* const ajv = new Ajv({ schemaId: 'id' })
      const validate = ajv.compile(schema)
      if (!validate(defaultConfig)) {
        console.error(chalk.red(`${validate.errors}`))
      } else {
        console.log(chalk.green("Default Config Validated"))
      } */
      const defaultConfigJson = await loadJsonFile(defaultConfigFilename)
      const defaultConfig = MasterConfig.parse(defaultConfigJson)
      console.log(chalk.gray('Loaded Default Config'))
      try {
        const userConfigJson = await loadJsonFile(filename)
        const userConfig = MasterConfig.parse(userConfigJson)
        /* if (!validate(userJson)) {
          console.error(chalk.red(`${validate.errors}`))
        } else {
          console.log(chalk.green("User Config Validated"))
        } */
        console.log(chalk.gray('Loaded User Config'))
        if (defaultConfig) {
          // _.mergeWith(userConfig, defaultConfig, customizer)
          return defaultConfig
        }
        return userConfig
      } catch (ex) {
        const error = ex as Error
        console.log(chalk.yellow(`No dnslint.json config file found.  Using defaults: ${error.message}`))
        console.error(error.stack)
        return defaultConfig
      }
    } catch (ex) {
      const error = ex as Error
      console.log(chalk.red(`Failed to load defaults: ${ex}`))
      console.error(error.stack)
      return new MasterConfig('master')
    }
  }

  public async start(params: {
    defaultConfig: string
    verbose: boolean
    output: string
    singleDomain?: string
    bucket?: string
    config?: MasterConfig
    preflight?: string
  }) {
    this.verbose = params.verbose
    this.config = await this.loadConfig('./dnslint.json', params.defaultConfig)
    this.preflight = params.preflight

    for (const domain of this.config.domains.values()) {
      domain.serverType = this.config.getServerType(domain.name)
    }

    // if domain specified, clear configed domains and add it
    if (params.singleDomain) {
      console.log(chalk.yellow(`Configuring Single Domain: ${params.singleDomain}`))
      const singleDomainConfig = this.config.getDomainConfig(params.singleDomain)
      this.config.domains.set(singleDomainConfig.name, singleDomainConfig)

      // since we are only doing one, remove the rest
      for (const domain of this.config.domains.values()) {
        if (domain.name !== '*' && domain.name !== params.singleDomain) {
          this.config.domains.delete(domain.key)
        }
      }

      this.config.aws = new AWSConfig('aws')
      this.config.aws.enabled = false
    }

    if (this.preflight) {
      await this.saveToFile(this.preflight, this.config)
    }

    this.validator = new MasterValidator(this.config)

    console.log(`Domains Found: ${this.config.domains.size}`)

    await this.validator.validate(this.verbose)

    if (params.bucket) {
      await this.saveToAws(params.bucket)
    }

    console.log(`Saving to File: ${params.output}`)
    await this.saveToFile(params.output, this.validator)
    if (this.validator.errorCount === 0) {
      console.log(chalk.green('Congratulations, all tests passed!'))
    } else {
      console.error(chalk.yellow(`Total Errors Found: ${this.validator.errorCount}`))
    }
    return this.validator
  }

  private getLatestS3FileName() {
    return 'latest.json'
  }

  private getHistoricS3FileName() {
    const date = new Date().toISOString()
    const parts = date.split('T')
    return `${parts[0]}/${parts[1]}.json`
  }

  private async saveToAws(bucket: string) {
    try {
      await this.aws.saveFileToS3(bucket, this.getLatestS3FileName(), this.validator)
      await this.aws.saveFileToS3(bucket, this.getHistoricS3FileName(), this.validator)
    } catch (ex) {
      const error = ex as Error
      console.error(chalk.red(error.message))
      console.error(chalk.red(error.stack))
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private saveToFile(filename: string, obj: any) {
    fs.open(filename, 'w', (err, fd) => {
      if (err) {
        console.log(`failed to open file: ${err}`)
      } else {
        fs.write(fd, JSON.stringify(obj), (errWrite) => {
          if (errWrite) {
            console.log(`failed to write file: ${errWrite}`)
          }
        })
      }
    })
  }
}
