import axiosLib from 'axios'
import config from '../config'

const axios = axiosLib.create({
  baseURL: config.APIEndpoint
})


export default {
  idToken: null,
  getFiles () {
    return axios.get('/get-files', {
      headers: {
        'Authorization': `Bearer ${this.idToken}`
      }
    })
  },
  addFolder () {
    return axios
  }
}