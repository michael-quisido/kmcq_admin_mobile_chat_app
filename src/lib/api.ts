import axios from "axios";

const API_BASE_URL = "https://kmcq-gmbh.com/";

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
