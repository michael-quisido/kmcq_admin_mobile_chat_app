import axios from "axios";

const API_BASE_URL = "http://192.168.5.89:3000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 10000,
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    return Promise.reject(error);
  }
);

export default api;
export { API_BASE_URL };
