import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { PetwalkHomebridgePlatform } from './platform';
import {default as axiosRequire, AxiosRequestConfig, AxiosResponse} from 'axios';
import http from 'http';
import https from 'https';
import { setIntervalAsync } from 'set-interval-async/fixed';


const axios = axiosRequire.create({
  //60 sec timeout
  timeout: 3000,
  //keepAlive pools and reuses TCP connections, so it's faster
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
  //follow up to 10 HTTP 3xx redirects
  maxRedirects: 10,
  //cap the maximum content length we'll accept to 50MBs, just in case
  maxContentLength: 50 * 1000 * 1000,
});

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class PetwalkPlatformAccessory {
  private service: Service;
  private inboundEntry: Service;
  private outboundEntry: Service;
  private rfid: Service;


  private currentDoorState = {
    'door': 'open',
    'system': 'on',
    'lastCallOk': true,
  };

   private targetDoorState = {
     'door': 'open',
     'system': 'on',
     'lastCallOk': true,
   };


   private config = {
     'brightnessSensor': false,
     'motion_in': false,
     'motion_out': true,
     'rfid': false,
     'time': false,
   };

   private baseAPIUrl = '';

   private doorStatusRequest: AxiosRequestConfig = {};
   private doorStatusChangeRequest: AxiosRequestConfig = {};
   private configRequest: AxiosRequestConfig = {};
   private configChangeRequest: AxiosRequestConfig = {};


   constructor(
    private readonly platform: PetwalkHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
   ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'petWalk')
      .setCharacteristic(this.platform.Characteristic.Model, 'petWalk')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // set PetWalk API address
    this.baseAPIUrl = 'http://' + this.accessory.context.device.ipAddress + ':8080/';

    const getDoorStatusUrl: AxiosRequestConfig = {
      method: 'get',
      url: this.baseAPIUrl + 'states',
      headers: { },
    };

    const putDoorStatusUrl: AxiosRequestConfig = {
      method: 'put',
      url: this.baseAPIUrl + 'states',
      headers: { 'Content-Type': 'application/json'},
    };

    const getConfigUrl: AxiosRequestConfig = {
      method: 'get',
      url: this.baseAPIUrl + 'modes',
      headers: { },
    };

    const putConfigUrl: AxiosRequestConfig = {
      method: 'put',
      url: this.baseAPIUrl + 'modes',
      headers: { 'Content-Type': 'application/json'},
    };

    this.doorStatusRequest = getDoorStatusUrl;
    this.doorStatusChangeRequest = putDoorStatusUrl;
    this.configRequest = getConfigUrl;
    this.configChangeRequest = putConfigUrl;

    this.service = this.accessory.getService(this.platform.Service.GarageDoorOpener)
      || this.accessory.addService(this.platform.Service.GarageDoorOpener);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentDoorState)
      .onGet(this.handleCurrentDoorStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetDoorState)
      .onGet(this.handleTargetDoorStateGet.bind(this))
      .onSet(this.handleTargetDoorStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.ObstructionDetected)
      .onGet(this.handleObstructionDetectedGet.bind(this));

    /**
     * Creating multiple services of the same type.
     *
     * To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
     * when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
     * this.accessory.getService('NAME') || this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE_ID');
     *
     * The USER_DEFINED_SUBTYPE must be unique to the platform accessory (if you platform exposes multiple accessories, each accessory
     * can use the same sub type id.)
     */

    this.inboundEntry = this.accessory.getService('Inbound Entry') ||
    this.accessory.addService(this.platform.Service.Switch, 'Inbound Entry', this.accessory.UUID+'-MIESW');

    // create handlers for required characteristics
    this.inboundEntry.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.handleConfigAttributeGet.bind(this, 'motion_in'))
      .onSet(this.handleConfigAttributeSet.bind(this, 'motion_in'));

    this.outboundEntry = this.accessory.getService('Outbound Entry') ||
      this.accessory.addService(this.platform.Service.Switch, 'Outbound Entry', this.accessory.UUID+'-MOESW');

    // create handlers for required characteristics
    this.outboundEntry.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.handleConfigAttributeGet.bind(this, 'motion_out'))
      .onSet(this.handleConfigAttributeSet.bind(this, 'motion_out'));

    this.rfid = this.accessory.getService('RFID Detection') ||
      this.accessory.addService(this.platform.Service.Switch, 'RFID Detection', this.accessory.UUID+'-RFIDSW');

    // create handlers for required characteristics
    this.rfid.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.handleConfigAttributeGet.bind(this, 'rfid'))
      .onSet(this.handleConfigAttributeSet.bind(this, 'rfid'));
    /**
     * Updating characteristics values asynchronously.
     *
     * Example showing how to update the state of a Characteristic asynchronously instead
     * of using the `on('get')` handlers.
     * Here we change update the motion sensor trigger states on and off every 10 seconds
     * the `updateCharacteristic` method.
     *
     */
    setIntervalAsync(async() => {

      await Promise.all([this.refreshPetwalkDoorStatus(), this.refreshConfigStatus()]);

      const currentDoorState: CharacteristicValue = this.readDoorState(true);

      this.service.updateCharacteristic(this.platform.Characteristic.CurrentDoorState, currentDoorState);
      this.inboundEntry.updateCharacteristic(this.platform.Characteristic.On, this.readConfigState('motion_in'));
      this.outboundEntry.updateCharacteristic(this.platform.Characteristic.On, this.readConfigState('motion_out'));
      this.rfid.updateCharacteristic(this.platform.Characteristic.On, this.readConfigState('rfid'));

    }, 500);


   }

   async refreshConfigStatus() {
     try {

       const response: AxiosResponse = await axios(this.configRequest);

       if(response.status === 200) {
         for(let i = 0; i < Object.keys(response.data).length; i++) {
           const keyVal = Object.keys(response.data)[i];
           if(response.data[keyVal] !== this.config[keyVal]) {
             this.platform.log.info( keyVal + ' config changed from ' + this.config[keyVal] + ' to ' + response.data[keyVal]);
           }
         }
         this.config = response.data;
       } else {
         throw new Error(JSON.stringify({status: response.status, data: response.data}));
       }
     } catch (error) {
       this.currentDoorState.lastCallOk = false;
       this.platform.log.warn(error);
     }
   }


   async refreshPetwalkDoorStatus() {
     try {

       const response: AxiosResponse = await axios(this.doorStatusRequest);

       if(response.status === 200 && response.data.door && response.data.system) {
         if(response.data.door !== this.currentDoorState.door) {
           this.platform.log.info('Door status changed from ' + this.currentDoorState.door + ' to ' + response.data.door);
         }
         if(response.data.system !== this.currentDoorState.system) {
           this.platform.log.info('System status changed from ' + this.currentDoorState.system + ' to ' + response.data.system);
         }
         this.currentDoorState = {'door' : response.data.door, 'system': response.data.system, 'lastCallOk': true};
       } else {
         throw new Error(JSON.stringify({status: response.status, data: response.data}));
       }
     } catch (error) {
       this.currentDoorState.lastCallOk = false;
       this.platform.log.warn(error);
     }
   }

   async updatePetwalkDoorStatus() {
     try {
       if(this.targetDoorState.door !== this.currentDoorState.door ) {
         this.platform.log.info('updating door status from: ' + this.currentDoorState.door + ' to ' + this.targetDoorState.door);

         const request = this.doorStatusChangeRequest;

         const data = this.targetDoorState;
         data.door = data.door === 'closed' ? 'close' : 'open';
         request.data = JSON.stringify(data);

         const response: AxiosResponse = await axios(request);

         if(response.status === 202 ) {
           this.platform.log.info('Requested door status change to ' + this.targetDoorState.door);
           await this.refreshPetwalkDoorStatus();
         } else {
           throw new Error(response.status.toString());
         }
       }
     } catch (error) {
       this.targetDoorState.lastCallOk = false;
       this.platform.log.warn(error);
     }
   }

   async updateConfig() {
     try {

       const request = this.configChangeRequest;

       const data = this.config;

       request.data = JSON.stringify(data);

       const response: AxiosResponse = await axios(request);

       if(response.status === 202 ) {
         this.platform.log.info('Requested config change complete');
         await this.refreshConfigStatus();
       } else {
         throw new Error(response.status.toString());
       }

     } catch (error) {
       this.targetDoorState.lastCallOk = false;
       this.platform.log.warn(error);
     }
   }

   readConfigState(AttributeName) {
     return this.config[AttributeName];
   }

   readDoorState(current: boolean) {

     const state = current ? this.currentDoorState : this.targetDoorState;


     return state.door === 'open' //this needs much better logic - but good for initial test
       ? this.platform.Characteristic.CurrentDoorState.OPEN
       : this.platform.Characteristic.CurrentDoorState.CLOSED;
   }


   /**
   * Handle requests to get the current value of a specified config characteristic
   */
   async handleConfigAttributeGet(AttributeName) {
     this.platform.log.debug('Triggered GET ConfigAttribute ' + AttributeName);

     // set this to a valid value for CurrentDoorState
     const currentValue = this.config[AttributeName];

     return currentValue;
   }

   /**
   * Handle requests to set the current value of a specified config characteristic
   */
   async handleConfigAttributeSet(AttributeName, value) {
     this.platform.log.debug('Triggered SET ConfigAttribute ' + AttributeName + ', Value: ' + value);

     this.config[AttributeName] = value;
     await this.updateConfig();
   }


   /**
   * Handle requests to get the current value of the "Current Door State" characteristic
   */
   async handleCurrentDoorStateGet() {
     this.platform.log.debug('Triggered GET CurrentDoorState');

     // set this to a valid value for CurrentDoorState
     const currentValue = this.readDoorState(true);


     return currentValue;
   }


   /**
     * Handle requests to get the current value of the "Target Door State" characteristic
     */
   async handleTargetDoorStateGet() {
     this.platform.log.debug('Triggered GET TargetDoorState');

     // set this to a valid value for TargetDoorState
     const currentValue = this.readDoorState(false);

     return currentValue;
   }

   /**
     * Handle requests to set the "Target Door State" characteristic
     */
   async handleTargetDoorStateSet(value) {



     this.platform.log.info('handleTargetDoorStateSet', value);
     if (this.platform.Characteristic.TargetDoorState.OPEN === value) {
       this.platform.log.debug('Triggered SET TargetDoorState: OPEN');
       this.targetDoorState.door = 'open';
     } else if (this.platform.Characteristic.TargetDoorState.CLOSED === value) {
       this.platform.log.debug('Triggered SET TargetDoorState: CLOSED');
       this.targetDoorState.door = 'closed';
     } else {
       this.platform.log.debug('Triggered SET TargetDoorState: UNKNOWN');
     }
     await this.updatePetwalkDoorStatus();
   }

   /**
     * Handle requests to get the current value of the "Obstruction Detected" characteristic
     */
   async handleObstructionDetectedGet() {
     this.platform.log.debug('Triggered GET ObstructionDetected');

     // set this to a valid value for ObstructionDetected
     const currentValue = false;

     return currentValue;
   }

}
