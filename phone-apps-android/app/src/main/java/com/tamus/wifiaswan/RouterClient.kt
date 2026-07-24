package com.tamus.wifiaswan

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.Base64

class RouterClient(
    private val httpClient: OkHttpClient = OkHttpClient(),
) {
    fun invoke(action: String, payload: JSONObject): JSONObject {
        return when (action) {
            "status" -> status(payload)
            "apply" -> apply(payload)
            "undo" -> undo(payload)
            else -> throw IllegalArgumentException("Unsupported action $action")
        }
    }

    private fun status(payload: JSONObject): JSONObject {
        val context = RouterContext(payload)
        val files = requestJsonArray(context, "/rest/file")
        val wifi = requestJsonValue(context, "/rest/interface/wifi")
        val registrations = requestJsonValue(context, "/rest/interface/wifi/registration-table")
        val dhcpClients = requestJsonValue(context, "/rest/ip/dhcp-client")
        val routes = requestJsonValue(context, "/rest/ip/route")
        return JSONObject()
            .put("reachable", true)
            .put("internetReachable", true)
            .put("activeWanInterface", "")
            .put("scriptUploaded", containsNamedFile(files, context.scriptFile))
            .put("schedulerInstalled", false)
            .put("bandwidth", JSONObject().put("note", "Native Android backend fallback via OkHttp."))
            .put("wifi", wifi)
            .put("registrations", registrations)
            .put("dhcpClients", dhcpClients)
            .put("routes", routes)
    }

    private fun apply(payload: JSONObject): JSONObject {
        val context = RouterContext(payload)
        upload(context, payload.getString("content"))
        requestJsonValue(
            context,
            "/rest/import",
            "POST",
            JSONObject().put("file-name", context.scriptFile),
        )
        return JSONObject()
            .put("uploaded", true)
            .put("imported", true)
            .put("fileName", context.scriptFile)
            .put("message", "Uploaded and imported ${context.scriptFile}")
    }

    private fun undo(payload: JSONObject): JSONObject {
        val scriptFile = payload.optString("scriptFileUndo", "undo-wifi-as-wan.rsc")
        val context = RouterContext(payload, scriptFile)
        val undoText = javaClass.classLoader
            ?.getResourceAsStream("web/undo-wifi-as-wan.rsc")
            ?.bufferedReader()
            ?.use { it.readText() }
            ?: ""
        upload(context, undoText)
        requestJsonValue(
            context,
            "/rest/import",
            "POST",
            JSONObject().put("file-name", context.scriptFile),
        )
        return JSONObject()
            .put("uploaded", true)
            .put("imported", true)
            .put("fileName", context.scriptFile)
            .put("message", "Uploaded and imported ${context.scriptFile}")
    }

    private fun upload(context: RouterContext, content: String) {
        val files = requestJsonArray(
            context,
            "/rest/file/print",
            "POST",
            JSONObject().put(".proplist", JSONArray().put(".id").put("name")),
        )
        val existingId = findFileId(files, context.scriptFile)
        if (existingId != null) {
            requestJsonValue(
                context,
                "/rest/file/$existingId",
                "PATCH",
                JSONObject().put("contents", content),
            )
            return
        }

        try {
            requestJsonValue(
                context,
                "/rest/file",
                "PUT",
                JSONObject().put("name", context.scriptFile).put("type", "file").put("contents", content),
            )
        } catch (_: Exception) {
            requestJsonValue(
                context,
                "/rest/file",
                "PUT",
                JSONObject().put("name", context.scriptFile).put("type", "file"),
            )
            val filesAgain = requestJsonArray(
                context,
                "/rest/file/print",
                "POST",
                JSONObject().put(".proplist", JSONArray().put(".id").put("name")),
            )
            val createdId = findFileId(filesAgain, context.scriptFile)
                ?: throw IllegalStateException("Could not locate ${context.scriptFile}")
            requestJsonValue(
                context,
                "/rest/file/$createdId",
                "PATCH",
                JSONObject().put("contents", content),
            )
        }
    }

    private fun requestJsonArray(
        context: RouterContext,
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
    ): JSONArray {
        val value = requestJsonValue(context, path, method, body)
        return when {
            value is JSONArray -> value
            value is JSONObject && value.has("value") -> value.getJSONArray("value")
            else -> JSONArray()
        }
    }

    private fun requestJsonValue(
        context: RouterContext,
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
    ): Any {
        val auth = Base64.getEncoder().encodeToString("${context.username}:${context.password}".toByteArray())
        val builder = Request.Builder()
            .url("${context.url.trimEnd('/')}$path")
            .header("Authorization", "Basic $auth")

        if (body != null) {
            builder.method(method, body.toString().toRequestBody("application/json".toMediaType()))
        } else if (method == "GET") {
            builder.get()
        } else {
            builder.method(method, ByteArray(0).toRequestBody(null))
        }

        httpClient.newCall(builder.build()).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("Router request $path failed: ${response.code} ${response.body?.string().orEmpty()}")
            }
            val text = response.body?.string().orEmpty()
            if (text.isBlank()) {
                return JSONObject()
            }
            return if (text.trimStart().startsWith("[")) JSONArray(text) else JSONObject(text)
        }
    }

    private fun findFileId(files: JSONArray, name: String): String? {
        for (index in 0 until files.length()) {
            val item = files.getJSONObject(index)
            if (item.optString("name") == name) {
                return item.optString(".id")
            }
        }
        return null
    }

    private fun containsNamedFile(files: JSONArray, name: String): Boolean {
        for (index in 0 until files.length()) {
            if (files.getJSONObject(index).optString("name") == name) {
                return true
            }
        }
        return false
    }
}

private data class RouterContext(
    val payload: JSONObject,
    val scriptFileOverride: String? = null,
) {
    val url: String = payload.getString("url")
    val username: String = payload.getString("username")
    val password: String = payload.optString("password", "")
    val scriptFile: String = scriptFileOverride ?: payload.optString("scriptFile", "enable-wifi-as-wan.rsc")
}
