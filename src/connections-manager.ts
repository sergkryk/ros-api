import { getConnection, RouterOSClient } from "./ros-openai";
import { getCredentials, NasServer } from "./config-preloader";

class ConnectionManager {
  async getConnection(nas: NasServer): Promise<RouterOSClient> {
    const credentials = getCredentials(nas);
    return await getConnection(nas, credentials.user, credentials.password);
  }
}

export default new ConnectionManager();
