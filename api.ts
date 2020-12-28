import bent from 'bent';
import { OnAir, Station } from './types';

type StationResponse = {
  region: {
    name?: string;
    id: string;
  };
  stations: Station[];
};

type OnAirResponse = {
  stations: OnAir[];
};

export default class Api {
  private cacheTime: number;

  private getStations: bent.RequestFunction<StationResponse>;
  private getOnAir: bent.RequestFunction<OnAirResponse>;

  private stationCacheTime = 0;
  private onAirCacheTime = 0;

  private stationCache: Station[] = [];
  private onAirCache: OnAir[] = [];
  
  constructor(region: string, cacheTime: number = 30000) {
    this.cacheTime = cacheTime;
    this.getStations = bent(`https://fred.aimapi.io/services/station/rova?region=${region}`, 'json');
    this.getOnAir = bent(`https://bruce.radioapi.io/services/onair/rova?region=${region}`, 'json');
  }

  async fetchStreamInfo(): Promise<Station[]> {
    const currentTime = Date.now();

    if ((currentTime - this.stationCacheTime) < this.cacheTime) {
      return this.stationCache;
    }
    
    this.stationCacheTime = currentTime;
    const response = await this.getStations('');
    this.stationCache = response.stations;
    return response.stations;
  }

  async fetchOnAirServices(): Promise<OnAir[]> {
    const currentTime = Date.now();

    if ((currentTime - this.onAirCacheTime) < this.cacheTime) {
      return this.onAirCache;
    }
    
    this.onAirCacheTime = currentTime;
    const response = await this.getOnAir('');
    this.onAirCache = response.stations;
    return response.stations;
  }
}