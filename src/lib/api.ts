import axios from "axios";

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

const API_BASE_URL = (configuredApiUrl || "https://kmcq-gmbh.com/").replace(/\/+$/, "");

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
