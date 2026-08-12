import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Activity, User, Clock, FileText } from "lucide-react";
import api from "@/services/api";
import { toast } from "sonner";

interface ActivityLog {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  user_role: string;
  action: string;
  target_type: string;
  target_id: number;
  details: string;
  created_at: string;
}

export default function ActivityLogsPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const response = await api.get("/activity-logs");
      setLogs(response.data);
    } catch (error) {
      console.error("Lỗi khi tải nhật ký hoạt động:", error);
      toast.error("Không thể tải danh sách nhật ký hoạt động");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const getActionBadge = (action: string) => {
    switch (action?.toUpperCase()) {
      case "BORROW":
        return <Badge className="bg-primary hover:bg-primary/90">Mượn sách</Badge>;
      case "RETURN":
        return <Badge className="bg-success hover:bg-success/90">Trả sách</Badge>;
      case "CREATE":
        return <Badge variant="outline" className="border-blue-500 text-blue-500">Tạo mới</Badge>;
      case "UPDATE":
        return <Badge variant="outline" className="border-amber-500 text-amber-500">Cập nhật</Badge>;
      case "DELETE":
        return <Badge variant="destructive">Xóa</Badge>;
      default:
        return <Badge variant="secondary">{action}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nhật ký hoạt động (Activity Log)</h1>
          <p className="text-muted-foreground">Theo dõi tất cả thao tác của người dùng và hệ thống.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Nhật ký hệ thống gần đây
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Chưa có nhật ký hoạt động nào.</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>Người thực hiện</TableHead>
                    <TableHead>Hành động</TableHead>
                    <TableHead>Đối tượng</TableHead>
                    <TableHead>Chi tiết</TableHead>
                    <TableHead className="w-40 text-right">Thời gian</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium">#{log.id}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium flex items-center gap-1">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            {log.user_name || "Hệ thống tự động"}
                          </span>
                          {log.user_email && <span className="text-xs text-muted-foreground">{log.user_email}</span>}
                        </div>
                      </TableCell>
                      <TableCell>{getActionBadge(log.action)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.target_type ? `${log.target_type} #${log.target_id || ''}` : "—"}
                      </TableCell>
                      <TableCell className="max-w-md text-xs text-muted-foreground leading-snug">
                        {log.details || "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        <span className="flex items-center justify-end gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(log.created_at).toLocaleString("vi-VN")}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
