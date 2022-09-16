import { config } from '../theme/appConfig'
import { asyncWaterfall, shuffleArray } from './utils'

const INFO_SERVERS = ['https://info1.edge.app', 'https://info2.edge.app']
const RATES_SERVERS = ['https://rates1.edge.app', 'https://rates2.edge.app']

// @ts-expect-error
export async function fetchWaterfall(servers?: string[], path: string, options?: any, timeout?: number = 5000): Promise<any> {
  if (servers == null) return
  const funcs = servers.map(server => async () => {
    const result = await fetch(server + '/' + path, options)
    if (typeof result !== 'object') {
      const msg = `Invalid return value ${path} in ${server}`
      console.log(msg)
      throw new Error(msg)
    }
    return result
  })
  return asyncWaterfall(funcs, timeout)
}

// @ts-expect-error
async function multiFetch(servers?: string[], path: string, options?: any, timeout?: number = 5000): Promise<any> {
  if (servers == null) return
  return fetchWaterfall(shuffleArray(servers), path, options, timeout)
}

export const fetchInfo = async (path: string, options?: Object, timeout?: number): Promise<any> => {
  return multiFetch(INFO_SERVERS, path, options, timeout)
}
export const fetchRates = async (path: string, options?: Object, timeout?: number): Promise<any> => {
  return multiFetch(RATES_SERVERS, path, options, timeout)
}
export const fetchReferral = async (path: string, options?: Object, timeout?: number): Promise<any> => {
  return multiFetch(config.referralServers, path, options, timeout)
}
export const fetchPush = async (path: string, options?: Object, timeout?: number): Promise<any> => {
  return multiFetch(config.notificationServers, path, options, timeout)
}
