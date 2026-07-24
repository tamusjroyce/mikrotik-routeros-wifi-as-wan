import Foundation

final class RouterBackend {
    func invoke(action: String, payload: [String: Any]) async throws -> [String: Any] {
        switch action {
        case "status":
            return try await status(payload: payload)
        case "apply":
            return try await apply(payload: payload)
        case "undo":
            return try await undo(payload: payload)
        default:
            throw NSError(domain: "RouterBackend", code: 400, userInfo: [NSLocalizedDescriptionKey: "Unsupported action \(action)"])
        }
    }

    private func status(payload: [String: Any]) async throws -> [String: Any] {
        let client = try RouterRestClient(payload: payload)
        return try await client.status()
    }

    private func apply(payload: [String: Any]) async throws -> [String: Any] {
        let client = try RouterRestClient(payload: payload)
        guard let content = payload["content"] as? String else {
            throw NSError(domain: "RouterBackend", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing script content"])
        }
        return try await client.apply(content: content)
    }

    private func undo(payload: [String: Any]) async throws -> [String: Any] {
        let client = try RouterRestClient(payload: payload, scriptFileKey: "scriptFileUndo", defaultScriptFile: "undo-wifi-as-wan.rsc")
        let url = Bundle.main.url(forResource: "undo-wifi-as-wan", withExtension: "rsc", subdirectory: "Web")
        let content = try url.map { try String(contentsOf: $0) } ?? ""
        return try await client.apply(content: content)
    }
}

private struct RouterRestClient {
    let baseURL: URL
    let username: String
    let password: String
    let scriptFile: String

    init(payload: [String: Any], scriptFileKey: String = "scriptFile", defaultScriptFile: String = "enable-wifi-as-wan.rsc") throws {
        guard let urlText = payload["url"] as? String,
              let baseURL = URL(string: urlText) else {
            throw NSError(domain: "RouterBackend", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing router URL"])
        }
        guard let username = payload["username"] as? String else {
            throw NSError(domain: "RouterBackend", code: 400, userInfo: [NSLocalizedDescriptionKey: "Missing username"])
        }

        self.baseURL = baseURL
        self.username = username
        self.password = payload["password"] as? String ?? ""
        self.scriptFile = payload[scriptFileKey] as? String ?? defaultScriptFile
    }

    func status() async throws -> [String: Any] {
        let files = try await json(path: "/rest/file")
        let wifi = try await json(path: "/rest/interface/wifi")
        let registrations = try await json(path: "/rest/interface/wifi/registration-table")
        let dhcpClients = try await json(path: "/rest/ip/dhcp-client")
        let routes = try await json(path: "/rest/ip/route")
        let schedulers = try await json(path: "/rest/system/scheduler")

        return [
            "reachable": true,
            "internetReachable": true,
            "activeWanInterface": "",
            "scriptUploaded": containsNamedItem(files, name: scriptFile),
            "schedulerInstalled": containsScheduler(schedulers),
            "bandwidth": [
                "note": "Native iOS backend fallback via URLSession."
            ],
            "wifi": filesArray(wifi),
            "registrations": filesArray(registrations),
            "dhcpClients": filesArray(dhcpClients),
            "routes": filesArray(routes)
        ]
    }

    func apply(content: String) async throws -> [String: Any] {
        try await upload(content: content)
        _ = try await json(path: "/rest/import", method: "POST", body: ["file-name": scriptFile])
        return [
            "uploaded": true,
            "imported": true,
            "fileName": scriptFile,
            "message": "Uploaded and imported \(scriptFile)"
        ]
    }

    private func upload(content: String) async throws {
        let files = try await json(path: "/rest/file/print", method: "POST", body: [".proplist": [".id", "name"]])
        if let fileID = filesArray(files).first(where: { ($0["name"] as? String) == scriptFile })?[".id"] as? String {
            _ = try await json(path: "/rest/file/\(fileID)", method: "PATCH", body: ["contents": content])
            return
        }

        do {
            _ = try await json(path: "/rest/file", method: "PUT", body: ["name": scriptFile, "type": "file", "contents": content])
        } catch {
            _ = try await json(path: "/rest/file", method: "PUT", body: ["name": scriptFile, "type": "file"])
            let filesAgain = try await json(path: "/rest/file/print", method: "POST", body: [".proplist": [".id", "name"]])
            guard let fileID = filesArray(filesAgain).first(where: { ($0["name"] as? String) == scriptFile })?[".id"] as? String else {
                throw error
            }
            _ = try await json(path: "/rest/file/\(fileID)", method: "PATCH", body: ["contents": content])
        }
    }

    private func json(path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Any {
        var request = URLRequest(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
        request.httpMethod = method
        let auth = Data("\(username):\(password)".utf8).base64EncodedString()
        request.setValue("Basic \(auth)", forHTTPHeaderField: "Authorization")
        if let body = body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "RouterBackend", code: 500, userInfo: [NSLocalizedDescriptionKey: "Router request \(path) failed: \(text)"])
        }

        if data.isEmpty {
            return [:]
        }

        return try JSONSerialization.jsonObject(with: data)
    }

    private func filesArray(_ value: Any) -> [[String: Any]] {
        if let array = value as? [[String: Any]] {
            return array
        }
        if let wrapper = value as? [String: Any], let array = wrapper["value"] as? [[String: Any]] {
            return array
        }
        return []
    }

    private func containsNamedItem(_ value: Any, name: String) -> Bool {
        filesArray(value).contains { ($0["name"] as? String) == name }
    }

    private func containsScheduler(_ value: Any) -> Bool {
        filesArray(value).contains { ($0["name"] as? String)?.contains("wifi-as-wan") == true }
    }
}
